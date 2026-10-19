import os
import hmac
import math
import asyncio
import json as json_lib
import logging
import re
from datetime import date as date_type
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response
from typing import Any
from pydantic import BaseModel
from dotenv import load_dotenv
# Carga backend/.env si existe (no pisa variables ya definidas, así que en Render/Docker no cambia nada).
# Debe ejecutarse antes de importar los servicios, que leen el entorno al importarse.
load_dotenv()

from services.prices import get_all_prices
from services.sheets import (
    get_finance_data, delete_transaction, post_transaction,
    ensure_comentario_column, update_transaction_comment, ensure_encrypted_columns,
    update_transaction,
    ensure_search_index, search_transactions,
)
from services.auth import (
    verify_google_token, create_jwt, get_current_user,
    hash_password, verify_password,
)
from services.users import (
    get_user, ensure_user, get_email_by_shortcut_token,
    ensure_password_column, get_password_hash, create_user_with_password,
)
from services.db import init_pool, run_in_thread
from services import user_data
from services.ratelimit import enforce, reset as ratelimit_reset, client_ip
from services.pending import (
    create_pending, get_pending, categorize_pending, delete_pending,
    create_pending_dedup, ensure_wallet_schema,
)
from services.wallet import (
    parse_importe, parse_fecha, today_madrid, clean_comercio, clean_id_externo,
)
from services.recurring import get_recurring
from services.ai_categorize import suggest_emoji
from services.email_report import send_monthly_report, send_monthly_reports_to_all
from services.goals import (
    ensure_goals_tables, get_goals_for_user, create_goal, update_goal,
    delete_goal, contribute, delete_contribution, share_goal,
)
from services.annual_expenses import (
    ensure_annual_expenses_table, list_for_user as list_annual_expenses,
    create as create_annual_expense, update as update_annual_expense,
    delete as delete_annual_expense,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    ensure_password_column()  # migración aditiva idempotente (columna password_hash)
    ensure_goals_tables()     # migración aditiva idempotente (metas de ahorro compartidas)
    ensure_comentario_column()  # migración aditiva idempotente (comentario libre en transacciones)
    ensure_encrypted_columns()  # migración aditiva idempotente (concepto/importe cifrados)
    ensure_annual_expenses_table()  # migración aditiva idempotente (gastos fijos anuales)
    ensure_search_index()  # migración aditiva idempotente (índice para paginar la búsqueda)
    ensure_wallet_schema()  # migración aditiva idempotente (Atajo de Cartera: comercio, reglas)
    user_data.ensure_user_data_schema()  # migración aditiva idempotente (categorías y prefs por usuario)
    yield


app = FastAPI(title="Control Gastos API", version="3.0.0", lifespan=lifespan)

_log = logging.getLogger("uvicorn.error")


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """Cualquier error no controlado: se registra en el servidor (con traza) y el
    cliente solo recibe un mensaje genérico, sin detalles de SQL ni de Python."""
    _log.error("Error no controlado en %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor"})

_raw_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,https://control-beta-ten.vercel.app"
)


def _normalize_origin(origin: str) -> str:
    """Normaliza un origen de CORS_ORIGINS: sin espacios, comillas, barra final
    ni mayúsculas (el navegador envía el Origin exacto, p. ej. sin '/' final)."""
    return origin.strip().strip('"\'').rstrip('/').lower()


def _parse_origins(raw: str) -> list[str]:
    origins: list[str] = []
    for part in raw.split(","):
        o = _normalize_origin(part)
        if o and o not in origins:
            origins.append(o)
    # "*" en la lista = permitir cualquier origen (comportamiento estándar de Starlette)
    return ["*"] if "*" in origins else origins


origins = _parse_origins(_raw_origins)
_log.info("CORS: orígenes permitidos = %s", origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "DELETE", "POST", "PATCH"],
    allow_headers=["*"],
)

_sse_clients: set[asyncio.Queue] = set()


# ── Auth ──────────────────────────────────────────────────────────────────────

class GoogleLoginIn(BaseModel):
    token: str


@app.post("/api/auth/login")
async def auth_login(body: GoogleLoginIn, request: Request):
    """Verifica el token de Google y auto-registra al usuario si es nuevo."""
    # 20 intentos/min por IP; al superarlo, bloqueo de 5 min
    enforce("google-login-ip", [client_ip(request)], limit=20, window=60, block=300)
    google_user   = await verify_google_token(body.token)
    email         = google_user["email"]
    name          = google_user.get("name") or email.split("@")[0]
    user_data     = await ensure_user(email, name)
    session_token = create_jwt(email)
    return {
        "session_token": session_token,
        "needs_setup":   False,
        "user": {
            "email":          email,
            "name":           name,
            "picture":        google_user.get("picture", ""),
            "shortcut_token": user_data.get("shortcut_token", ""),
        },
    }


@app.get("/api/auth/me")
async def auth_me(email: str = Depends(get_current_user)):
    user = await get_user(email)
    return {"email": email, "name": (user or {}).get("name", "")}


# ── Auth por email + contraseña ───────────────────────────────────────────────

import re
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterIn(BaseModel):
    email:    str
    name:     str
    password: str


class EmailLoginIn(BaseModel):
    email:    str
    password: str


def _session_response(email: str, name: str, shortcut_token: str) -> dict:
    return {
        "session_token": create_jwt(email),
        "needs_setup":   False,
        "user": {
            "email":          email,
            "name":           name,
            "picture":        "",
            "shortcut_token": shortcut_token,
        },
    }


@app.post("/api/auth/register")
async def auth_register(body: RegisterIn, request: Request):
    email = body.email.strip().lower()
    name  = body.name.strip() or email.split("@")[0]

    # 5 registros/10 min por IP (bloqueo 15 min); 3/10 min por email
    enforce("reg-ip", [client_ip(request)], limit=5, window=600, block=900)
    enforce("reg-email", [email], limit=3, window=600, block=900)

    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Email no válido")
    if len(body.password) < 10:
        raise HTTPException(status_code=422, detail="La contraseña debe tener al menos 10 caracteres")

    created = await create_user_with_password(email, name, hash_password(body.password))
    if created is None:
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con este email")

    return _session_response(email, created["name"], created["shortcut_token"])


# Hash bcrypt (cost 12, igual que hash_password) de un valor aleatorio descartado:
# solo sirve para igualar tiempos en el login cuando el email no tiene contraseña.
_DUMMY_PASSWORD_HASH = "$2b$12$qhPMykdSQCNekEYVLcPpDuDQnNZiGgY4bwnnuetzdUsewqqMBM3Py"


@app.post("/api/auth/login-email")
async def auth_login_email(body: EmailLoginIn, request: Request):
    email = body.email.strip().lower()
    # 5 intentos/min por email y 20/min por IP; al superarlo, bloqueo de 5 min
    enforce("login-ip", [client_ip(request)], limit=20, window=60, block=300)
    enforce("login-email", [email], limit=5, window=60, block=300)
    pw_hash = await get_password_hash(email)

    # Error genérico: no revela si el email existe (evita enumeración de usuarios)
    if not pw_hash:
        # Sin hash (email inexistente o cuenta solo-Google): se ejecuta igualmente
        # un bcrypt de relleno para que el tiempo de respuesta no delate qué emails existen.
        verify_password(body.password, _DUMMY_PASSWORD_HASH)
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")
    if not verify_password(body.password, pw_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")
    # Login correcto: los aciertos no cuentan para el límite por email (el de IP se mantiene)
    ratelimit_reset("login-email", email)

    user = await get_user(email)
    return _session_response(email, (user or {}).get("name", ""), (user or {}).get("shortcut_token", ""))


# ── SSE ───────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/events")
async def sse_events():
    q: asyncio.Queue = asyncio.Queue()
    _sse_clients.add(q)

    async def stream():
        try:
            yield "event: ping\ndata: connected\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"event: update\ndata: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield "event: ping\ndata: keepalive\n\n"
        finally:
            _sse_clients.discard(q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _broadcast():
    for q in list(_sse_clients):
        await q.put("data_updated")


@app.post("/api/notify")
async def notify_update(email: str = Depends(get_current_user)):
    await _broadcast()
    return {"notified": len(_sse_clients)}


# ── Finanzas (protegidas) ─────────────────────────────────────────────────────

@app.get("/api/finance")
async def finance_data(year: int | None = Query(default=None, ge=2000, le=2100),
                       email: str = Depends(get_current_user)):
    try:
        return await get_finance_data(email, year)
    except HTTPException:
        raise
    except Exception:
        _log.exception("Error en GET /api/finance")
        raise HTTPException(status_code=500, detail="Error interno al cargar los datos")


@app.get("/api/transactions/search")
async def search_transactions_endpoint(
    q: str = "", tipo: str = "all", cursor: str | None = None, limit: int = 30,
    email: str = Depends(get_current_user),
):
    try:
        return await search_transactions(email, q=q, tipo=tipo, cursor=cursor, limit=limit)
    except HTTPException:
        raise
    except Exception:
        raise  # lo gestiona el handler global (log en servidor, mensaje genérico)


@app.delete("/api/transactions/{row_index}")
async def delete_transaction_endpoint(row_index: int, email: str = Depends(get_current_user)):
    try:
        return await delete_transaction(row_index, email)
    except HTTPException:
        raise
    except Exception:
        raise  # lo gestiona el handler global (log en servidor, mensaje genérico)


class TransactionIn(BaseModel):
    importe:    float
    tipo:       str
    concepto:   str
    fecha:      str | None = None  # YYYY-MM-DD; si no se pasa, usa CURRENT_DATE
    source:     str = "shortcut"
    comentario: str | None = None


@app.post("/api/transaction")
async def add_transaction(request: Request, email: str = Depends(get_current_user)):
    raw = await request.body()
    try:
        data = json_lib.loads(raw)
        if isinstance(data, str):
            data = json_lib.loads(data)
        tx = TransactionIn(**data)
    except Exception:
        raise HTTPException(status_code=422, detail="Body inválido")

    try:
        result = await post_transaction(
            tx.importe, tx.tipo, tx.concepto, email, tx.source, tx.fecha,
            (tx.comentario or "").strip() or None,
        )
    except HTTPException:
        raise
    except Exception:
        _log.exception("Error en POST /api/transaction")
        raise HTTPException(status_code=502, detail="Error al guardar la transacción")

    await _broadcast()
    return result


class CommentIn(BaseModel):
    comentario: str


@app.patch("/api/transactions/{row_index}/comment")
async def update_transaction_comment_endpoint(
    row_index: int, body: CommentIn, email: str = Depends(get_current_user)
):
    try:
        result = await update_transaction_comment(row_index, email, body.comentario.strip())
    except HTTPException:
        raise
    except Exception:
        raise  # lo gestiona el handler global (log en servidor, mensaje genérico)
    await _broadcast()
    return result


# ── Edición de transacciones ─────────────────────────────────────────────────

TIPOS_VALIDOS = ("Ingreso", "Gasto Fijo", "Gasto Variable")  # = TYPES del frontend
_CONCEPTO_MAX   = 60
_COMENTARIO_MAX = 500
_IMPORTE_MAX    = 1_000_000
_FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_CAMPOS_EDITABLES = ("fecha", "importe", "tipo", "concepto", "comentario")


def _err422(msg: str):
    raise HTTPException(status_code=422, detail=msg)


def _validate_tx_patch(data) -> dict:
    """Valida el body parcial de PATCH /api/transactions/{id} y devuelve solo los
    campos editables, ya normalizados. Claves desconocidas se ignoran."""
    if not isinstance(data, dict):
        _err422("El cuerpo debe ser un objeto JSON")
    changes: dict = {}

    if "fecha" in data:
        f = data["fecha"]
        if not isinstance(f, str) or not _FECHA_RE.match(f.strip()):
            _err422("La fecha debe tener el formato AAAA-MM-DD")
        try:
            d = date_type.fromisoformat(f.strip())
        except ValueError:
            _err422("La fecha no es válida")
        if d.year < 2000 or d.year > date_type.today().year + 1:
            _err422(f"El año de la fecha debe estar entre 2000 y {date_type.today().year + 1}")
        changes["fecha"] = d.isoformat()

    if "importe" in data:
        v = data["importe"]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            _err422("El importe debe ser un número")
        try:
            v = float(v)  # enteros enormes -> OverflowError
        except OverflowError:
            _err422("El importe no puede superar 1.000.000")
        if not math.isfinite(v):
            _err422("El importe debe ser un número finito")
        if v <= 0:
            _err422("El importe debe ser mayor que 0")
        if v > _IMPORTE_MAX:
            _err422("El importe no puede superar 1.000.000")
        changes["importe"] = float(v)

    if "tipo" in data:
        t = data["tipo"]
        if not isinstance(t, str) or t.strip() not in TIPOS_VALIDOS:
            _err422("El tipo debe ser uno de: " + ", ".join(TIPOS_VALIDOS))
        changes["tipo"] = t.strip()

    if "concepto" in data:
        c = data["concepto"]
        if not isinstance(c, str) or not c.strip():
            _err422("El concepto no puede estar vacío")
        c = c.strip()
        if len(c) > _CONCEPTO_MAX:
            _err422(f"El concepto no puede superar {_CONCEPTO_MAX} caracteres")
        changes["concepto"] = c

    if "comentario" in data:
        cm = data["comentario"]
        if cm is None:
            cm = ""  # null = borrar, igual que ""
        if not isinstance(cm, str):
            _err422("El comentario debe ser texto")
        cm = cm.strip()
        if len(cm) > _COMENTARIO_MAX:
            _err422(f"El comentario no puede superar {_COMENTARIO_MAX} caracteres")
        changes["comentario"] = cm

    if not changes:
        _err422("Indica al menos un campo a modificar: " + ", ".join(_CAMPOS_EDITABLES))
    return changes


@app.patch("/api/transactions/{tx_id}")
async def update_transaction_endpoint(
    tx_id: int, request: Request, email: str = Depends(get_current_user)
):
    try:
        data = json_lib.loads(await request.body() or b"null")
    except ValueError:
        _err422("El cuerpo no es JSON válido")
    changes = _validate_tx_patch(data)
    result = await update_transaction(tx_id, email, changes)  # 404 si no es suyo
    await _broadcast()
    return result


# ── Pendientes (Shortcut → DB → App) ─────────────────────────────────────────

_PENDING_BODY_MAX = 4096  # bytes
_FUENTES_PENDING = ("wallet", "manual")


@app.post("/api/pending")
async def create_pending_tx(request: Request, email: str = Depends(get_current_user)):
    """Crea un gasto PENDIENTE de categorizar con la sesión activa.

    Flujo Apple Pay: la automatización "Transacción" de Cartera ejecuta un Atajo
    que abre la app con comercio + importe en la URL, y la app (con su JWT) lo
    envía aquí. Body: {importe: number|string, comercio?, fecha?, fuente?:
    "wallet"|"manual", id_externo?}. Compatible con el body antiguo {importe, fecha?}.
    Deduplica reintentos (mismo id_externo en 24 h, o mismo importe+comercio en
    < 2 min) devolviendo el existente con estado "duplicada".
    Nunca se registra en logs el comercio ni el importe; los 422 son genéricos.
    """
    # 30/min y 300/día por usuario (frena un Atajo o una pestaña en bucle)
    enforce("pending-min", [email], limit=30, window=60, block=300)
    enforce("pending-day", [email], limit=300, window=86400, block=3600)

    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > _PENDING_BODY_MAX:
        raise HTTPException(status_code=413, detail="Body demasiado grande")
    raw = await request.body()
    if len(raw) > _PENDING_BODY_MAX:
        raise HTTPException(status_code=413, detail="Body demasiado grande")
    try:
        data = json_lib.loads(raw)
        if isinstance(data, str):  # JSON enviado como texto
            data = json_lib.loads(data)
    except Exception:
        data = None
    if not isinstance(data, dict):
        _err422("Body inválido")

    try:
        importe = parse_importe(data.get("importe"))
    except ValueError:
        _err422("importe inválido")
    try:
        fecha = parse_fecha(data.get("fecha"))  # falta → hoy en Europe/Madrid
    except ValueError:
        _err422("fecha inválida")
    fuente = data.get("fuente")
    if fuente is None:
        fuente = "manual"
    if fuente not in _FUENTES_PENDING:
        _err422("fuente inválida")
    comercio = clean_comercio(data.get("comercio"))
    id_externo = clean_id_externo(data.get("id_externo"))

    r = await create_pending_dedup(email, importe, fecha.isoformat(), comercio, id_externo, fuente)
    s = r["sugerencia"]
    if not r["duplicada"]:
        await _broadcast()
    return {
        "estado": "duplicada" if r["duplicada"] else "pendiente",
        "id": r["id"],
        "importe": r["importe"],
        "comercio": r["comercio"],
        "fecha": r["fecha"],
        "sugerencia": {"tipo": s["tipo"], "concepto": s["concepto"], "origen": s["origen"]} if s else None,
    }


@app.get("/api/pending")
async def get_pending_txs(email: str = Depends(get_current_user)):
    return await get_pending(email)


class CategorizeIn(BaseModel):
    tipo:       str
    concepto:   str
    recordar:   bool = True         # aprender la regla comercio → categoría
    comentario: str | None = None   # ≤ 500, se guarda en la transacción creada


@app.post("/api/pending/{pending_id}/categorize")
async def categorize_pending_tx(pending_id: int, body: CategorizeIn, email: str = Depends(get_current_user)):
    comentario = (body.comentario or "").strip() or None
    if comentario and len(comentario) > _COMENTARIO_MAX:
        _err422(f"El comentario no puede superar {_COMENTARIO_MAX} caracteres")
    result = await categorize_pending(
        pending_id, email, body.tipo, body.concepto,
        recordar=body.recordar, comentario=comentario,
    )
    await _broadcast()
    return result


@app.delete("/api/pending/{pending_id}")
async def delete_pending_tx(pending_id: int, email: str = Depends(get_current_user)):
    """Descarta un pendiente propio (Wallet también avisa de pagos rechazados)."""
    result = await delete_pending(pending_id, email)  # 404 si no es suyo / no existe
    await _broadcast()
    return result


# ── Atajo iOS (token permanente, sin JWT) ────────────────────────────────────

SHORTCUT_MAX_IMPORTE = 1_000_000

@app.post("/api/shortcut/pending")
async def shortcut_create_pending(request: Request):
    """Atajo iOS: guarda un gasto pendiente usando el token permanente del usuario.
    No requiere abrir la app — el usuario categoriza después desde la campana."""
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("el body debe ser un objeto JSON")
    except Exception:
        raise HTTPException(status_code=422, detail="Body inválido")

    token = data.get("shortcut_token") or data.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="shortcut_token requerido")
    # 30 peticiones/min por token (también frena el tanteo de tokens inválidos)
    enforce("shortcut", [str(token)], limit=30, window=60, block=300)

    email = await get_email_by_shortcut_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Token inválido")

    try:
        raw = data.get("importe") or data.get("amount") or data.get("Importe")
        importe = float(str(raw).replace(",", ".").replace(" ", ""))
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=422, detail="importe inválido")

    if not math.isfinite(importe):
        raise HTTPException(status_code=422, detail="importe inválido")
    if importe <= 0:
        raise HTTPException(status_code=422, detail="importe debe ser mayor que 0")
    if importe > SHORTCUT_MAX_IMPORTE:
        raise HTTPException(status_code=422, detail="importe demasiado alto")

    # Fecha recibida si es válida; si falta o no se entiende, HOY en Europe/Madrid
    # (no CURRENT_DATE de la BD, que va en UTC). Se tolera un formato desconocido
    # por compatibilidad con Atajos antiguos que nunca enviaron fecha.
    try:
        fecha = parse_fecha(data.get("fecha"))
    except ValueError:
        fecha = today_madrid()

    result = await create_pending(email, importe, fecha.isoformat(), fuente="atajo")
    await _broadcast()  # la PWA recibe SSE y actualiza la campana en tiempo real
    return result


# ── Recurrentes / Suscripciones ───────────────────────────────────────────────

@app.get("/api/recurring")
async def recurring_expenses(email: str = Depends(get_current_user)):
    """Detecta gastos recurrentes (suscripciones) en el historial del usuario."""
    try:
        return await get_recurring(email)
    except Exception:
        raise  # lo gestiona el handler global (log en servidor, mensaje genérico)


# ── Categorización con IA ───────────────────────────────────────────────────

class EmojiSuggestIn(BaseModel):
    nombre: str


@app.post("/api/categorize/suggest-emoji")
async def suggest_emoji_endpoint(body: EmojiSuggestIn, email: str = Depends(get_current_user)):
    """Sugiere un emoji para una categoría nueva a partir de su nombre (Claude API)."""
    emoji = await suggest_emoji(body.nombre.strip())
    return {"emoji": emoji}


# ── Informe mensual por email ─────────────────────────────────────────────────

CRON_SECRET = os.getenv("CRON_SECRET", "")


@app.post("/api/reports/monthly/send")
async def send_my_monthly_report(email: str = Depends(get_current_user)):
    """El usuario logado se envía su propio informe del mes anterior."""
    user = await get_user(email)
    result = await send_monthly_report(email, (user or {}).get("name", ""))
    if not result.get("sent"):
        raise HTTPException(status_code=422, detail=result.get("reason", "No se pudo enviar"))
    return result


@app.post("/api/reports/monthly/send-all")
async def send_all_monthly_reports(request: Request):
    """Envía el informe del mes anterior a todos los usuarios.
    Pensado para un cron externo — protegido por un secreto compartido,
    no por sesión de usuario."""
    secret = request.headers.get("x-cron-secret", "")
    # Comparación en tiempo constante (no filtra el secreto por timing)
    if not CRON_SECRET or not hmac.compare_digest(secret.encode("utf-8"), CRON_SECRET.encode("utf-8")):
        raise HTTPException(status_code=401, detail="No autorizado")
    return {"results": await send_monthly_reports_to_all()}


# ── Metas de ahorro (compartibles entre usuarios) ────────────────────────────

class GoalIn(BaseModel):
    nombre:     str
    objetivo:   float
    emoji:      str = "🎯"
    fecha:      str | None = None
    imagen_url: str | None = None  # gif/imagen personalizada, alternativa al emoji


class ContributeIn(BaseModel):
    importe: float
    foto:    str | None = None  # data-URL JPEG, comprimida en el cliente


# El cliente redimensiona a ~800px y comprime a JPEG antes de subir, así que
# una foto normal ronda los 50-150KB. El límite alto es solo un cortafuegos.
_FOTO_MAX_CHARS = 800_000  # ~600KB reales en base64


def _clean_foto(raw: str | None) -> str | None:
    foto = (raw or "").strip()
    if not foto:
        return None
    if not foto.startswith("data:image/"):
        raise HTTPException(status_code=422, detail="La foto debe ser una imagen")
    if len(foto) > _FOTO_MAX_CHARS:
        raise HTTPException(status_code=422, detail="La foto es demasiado grande, inténtalo con otra")
    return foto


class ShareIn(BaseModel):
    email: str


@app.get("/api/goals")
async def list_goals_endpoint(email: str = Depends(get_current_user)):
    return await get_goals_for_user(email)


def _clean_imagen_url(raw: str | None) -> str | None:
    url = (raw or "").strip()
    if not url:
        return None
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=422, detail="La URL de la imagen debe empezar por http:// o https://")
    return url


@app.post("/api/goals")
async def create_goal_endpoint(body: GoalIn, email: str = Depends(get_current_user)):
    if not body.nombre.strip():
        raise HTTPException(status_code=422, detail="Escribe un nombre")
    if body.objetivo <= 0:
        raise HTTPException(status_code=422, detail="El objetivo debe ser mayor que 0")
    imagen_url = _clean_imagen_url(body.imagen_url)
    return await create_goal(email, body.nombre.strip(), body.objetivo, body.emoji, body.fecha, imagen_url)


@app.patch("/api/goals/{goal_id}")
async def update_goal_endpoint(goal_id: int, body: GoalIn, email: str = Depends(get_current_user)):
    if not body.nombre.strip():
        raise HTTPException(status_code=422, detail="Escribe un nombre")
    if body.objetivo <= 0:
        raise HTTPException(status_code=422, detail="El objetivo debe ser mayor que 0")
    imagen_url = _clean_imagen_url(body.imagen_url)
    return await update_goal(goal_id, email, body.nombre.strip(), body.objetivo, body.emoji, body.fecha, imagen_url)


@app.delete("/api/goals/{goal_id}")
async def delete_goal_endpoint(goal_id: int, email: str = Depends(get_current_user)):
    await delete_goal(goal_id, email)
    return {"status": "ok"}


@app.post("/api/goals/{goal_id}/contribute")
async def contribute_endpoint(goal_id: int, body: ContributeIn, email: str = Depends(get_current_user)):
    return await contribute(goal_id, email, body.importe, _clean_foto(body.foto))


@app.delete("/api/goals/{goal_id}/contributions/{contribution_id}")
async def delete_contribution_endpoint(goal_id: int, contribution_id: int, email: str = Depends(get_current_user)):
    return await delete_contribution(goal_id, contribution_id, email)


@app.post("/api/goals/{goal_id}/share")
async def share_goal_endpoint(goal_id: int, body: ShareIn, email: str = Depends(get_current_user)):
    return await share_goal(goal_id, email, body.email)


# ── Gastos fijos anuales (IBI, seguro del coche…) ────────────────────────────

class AnnualExpenseIn(BaseModel):
    nombre:        str
    importe:       float
    mes:           int
    dia:           int = 1
    meses_reparto: list[int] | None = None
    avisar:        bool = True
    dias_aviso:    int = 15


def _validate_annual_expense(body: "AnnualExpenseIn"):
    if not body.nombre.strip():
        raise HTTPException(status_code=422, detail="Escribe un nombre")
    if body.importe <= 0:
        raise HTTPException(status_code=422, detail="El importe debe ser mayor que 0")
    if not (1 <= body.mes <= 12):
        raise HTTPException(status_code=422, detail="El mes debe estar entre 1 y 12")
    if not (1 <= body.dia <= 31):
        raise HTTPException(status_code=422, detail="El día debe estar entre 1 y 31")
    if body.meses_reparto is not None:
        if not (1 <= len(body.meses_reparto) <= 12):
            raise HTTPException(status_code=422, detail="Elige entre 1 y 12 meses para el reparto")
        if any(not (1 <= m <= 12) for m in body.meses_reparto):
            raise HTTPException(status_code=422, detail="Los meses del reparto deben estar entre 1 y 12")
        if len(set(body.meses_reparto)) != len(body.meses_reparto):
            raise HTTPException(status_code=422, detail="No repitas el mismo mes en el reparto")


@app.get("/api/annual-expenses")
async def list_annual_expenses_endpoint(email: str = Depends(get_current_user)):
    return await list_annual_expenses(email)


@app.post("/api/annual-expenses")
async def create_annual_expense_endpoint(body: AnnualExpenseIn, email: str = Depends(get_current_user)):
    _validate_annual_expense(body)
    return await create_annual_expense(
        email, body.nombre.strip(), body.importe, body.mes, body.dia,
        body.meses_reparto, body.avisar, body.dias_aviso,
    )


@app.patch("/api/annual-expenses/{expense_id}")
async def update_annual_expense_endpoint(expense_id: int, body: AnnualExpenseIn, email: str = Depends(get_current_user)):
    _validate_annual_expense(body)
    return await update_annual_expense(
        email, expense_id, body.nombre.strip(), body.importe, body.mes, body.dia,
        body.meses_reparto, body.avisar, body.dias_aviso,
    )


@app.delete("/api/annual-expenses/{expense_id}")
async def delete_annual_expense_endpoint(expense_id: int, email: str = Depends(get_current_user)):
    await delete_annual_expense(email, expense_id)
    return {"status": "ok"}


# ── Categorías y preferencias propias del usuario ─────────────────────────────
# El usuario sale siempre del JWT. Nombres y JSON van cifrados en la BD; no se
# registra ningún contenido en logs.

class CategoryIn(BaseModel):
    tipo: str
    concepto: str
    emoji: str | None = None


class CategoryPatchIn(BaseModel):
    concepto: str | None = None
    emoji: str | None = None


class CategoryImportIn(BaseModel):
    items: list[Any]


def _limit_user_writes(email: str):
    enforce("userdata-min", [email], limit=60, window=60, block=300)
    enforce("userdata-day", [email], limit=2000, window=86400, block=3600)


@app.get("/api/categories")
async def list_categories_endpoint(email: str = Depends(get_current_user)):
    return await run_in_thread(lambda: user_data.list_categories(email))


@app.post("/api/categories", status_code=201)
async def create_category_endpoint(body: CategoryIn, email: str = Depends(get_current_user)):
    _limit_user_writes(email)
    return await run_in_thread(lambda: user_data.create_category(email, body.tipo, body.concepto, body.emoji))


@app.post("/api/categories/import")
async def import_categories_endpoint(body: CategoryImportIn, email: str = Depends(get_current_user)):
    _limit_user_writes(email)
    return await run_in_thread(lambda: user_data.import_categories(email, body.items))


@app.patch("/api/categories/{category_id}")
async def update_category_endpoint(category_id: int, body: CategoryPatchIn, email: str = Depends(get_current_user)):
    _limit_user_writes(email)
    return await run_in_thread(lambda: user_data.update_category(email, category_id, body.concepto, body.emoji))


@app.delete("/api/categories/{category_id}", status_code=204)
async def delete_category_endpoint(category_id: int, email: str = Depends(get_current_user)):
    _limit_user_writes(email)
    await run_in_thread(lambda: user_data.delete_category(email, category_id))
    return Response(status_code=204)


@app.get("/api/prefs")
async def get_prefs_endpoint(email: str = Depends(get_current_user)):
    return await run_in_thread(lambda: user_data.get_prefs(email))


@app.put("/api/prefs/{kind}")
async def put_pref_endpoint(kind: str, request: Request, email: str = Depends(get_current_user)):
    if kind not in user_data.PREF_KINDS:
        raise HTTPException(status_code=422, detail="kind no permitido")
    _limit_user_writes(email)
    too_big = HTTPException(status_code=413, detail="Datos demasiado grandes (máx. 64 KB)")
    # Corta cuerpos enormes antes de leerlos (el tope exacto, 64 KB de JSON, se valida en el servicio).
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > user_data.PREFS_MAX_BYTES + 1024:
        raise too_big
    raw = await request.body()
    if len(raw) > user_data.PREFS_MAX_BYTES + 1024:
        raise too_big
    try:
        payload = json_lib.loads(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="JSON inválido")
    if not isinstance(payload, dict) or "data" not in payload:
        raise HTTPException(status_code=422, detail='Falta el campo "data"')
    return await run_in_thread(lambda: user_data.put_pref(email, kind, payload["data"]))


# ── Inversiones ───────────────────────────────────────────────────────────────

@app.get("/api/investments/prices")
async def investment_prices():
    try:
        return await get_all_prices()
    except Exception:
        raise  # lo gestiona el handler global (log en servidor, mensaje genérico)

