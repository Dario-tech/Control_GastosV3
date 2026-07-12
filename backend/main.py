import os
import asyncio
import json as json_lib
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.prices import get_all_prices
from services.sheets import (
    get_finance_data, get_raw_transactions, delete_transaction, post_transaction,
    ensure_comentario_column, update_transaction_comment,
)
from services.auth import (
    verify_google_token, create_jwt, get_current_user,
    hash_password, verify_password,
)
from services.users import (
    get_user, ensure_user, get_email_by_shortcut_token,
    ensure_password_column, get_password_hash, create_user_with_password,
)
from services.db import init_pool
from services.pending import create_pending, get_pending, categorize_pending
from services.recurring import get_recurring
from services.ai_categorize import suggest_emoji
from services.email_report import send_monthly_report, send_monthly_reports_to_all
from services.goals import (
    ensure_goals_tables, get_goals_for_user, create_goal, update_goal,
    delete_goal, contribute, delete_contribution, share_goal,
)
from services.premium import ensure_premium_column, is_premium
from services.revolut import (
    ensure_bank_connections_table, get_connection, connect as revolut_connect,
    confirm as revolut_confirm, disconnect as revolut_disconnect, sync as revolut_sync,
    is_configured as revolut_is_configured, RevolutNotConfigured,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    ensure_password_column()  # migración aditiva idempotente (columna password_hash)
    ensure_goals_tables()     # migración aditiva idempotente (metas de ahorro compartidas)
    ensure_comentario_column()  # migración aditiva idempotente (comentario libre en transacciones)
    ensure_premium_column()          # migración aditiva idempotente (freemium)
    ensure_bank_connections_table()  # migración aditiva idempotente (conexión Revolut/GoCardless)
    yield


app = FastAPI(title="Control Gastos API", version="3.0.0", lifespan=lifespan)

_raw_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,https://control-beta-ten.vercel.app"
)
origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

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
async def auth_login(body: GoogleLoginIn):
    """Verifica el token de Google y auto-registra al usuario si es nuevo."""
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
async def auth_register(body: RegisterIn):
    email = body.email.strip().lower()
    name  = body.name.strip() or email.split("@")[0]

    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Email no válido")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="La contraseña debe tener al menos 8 caracteres")

    created = await create_user_with_password(email, name, hash_password(body.password))
    if created is None:
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con este email")

    return _session_response(email, created["name"], created["shortcut_token"])


@app.post("/api/auth/login-email")
async def auth_login_email(body: EmailLoginIn):
    email = body.email.strip().lower()
    pw_hash = await get_password_hash(email)

    # Error genérico: no revela si el email existe (evita enumeración de usuarios)
    if not pw_hash or not verify_password(body.password, pw_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")

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
async def notify_update():
    await _broadcast()
    return {"notified": len(_sse_clients)}


# ── Finanzas (protegidas) ─────────────────────────────────────────────────────

@app.get("/api/finance")
async def finance_data(email: str = Depends(get_current_user)):
    try:
        return await get_finance_data(email)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/transactions/{row_index}")
async def delete_transaction_endpoint(row_index: int, email: str = Depends(get_current_user)):
    try:
        return await delete_transaction(row_index, email)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Body inválido: {e}")

    try:
        result = await post_transaction(
            tx.importe, tx.tipo, tx.concepto, email, tx.source, tx.fecha,
            (tx.comentario or "").strip() or None,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error al escribir en la base de datos: {e}")

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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    await _broadcast()
    return result


# ── Pendientes (Shortcut → DB → App) ─────────────────────────────────────────

class PendingIn(BaseModel):
    importe: float
    fecha: str | None = None  # YYYY-MM-DD; si no se pasa, el backend usa CURRENT_DATE

@app.post("/api/pending")
async def create_pending_tx(body: PendingIn, email: str = Depends(get_current_user)):
    """La app guarda el importe con la fecha real del Atajo usando la sesión activa."""
    if body.importe <= 0:
        raise HTTPException(status_code=422, detail="importe inválido")
    return await create_pending(email, body.importe, body.fecha)


@app.get("/api/pending")
async def get_pending_txs(email: str = Depends(get_current_user)):
    return await get_pending(email)


class CategorizeIn(BaseModel):
    tipo:     str
    concepto: str


@app.post("/api/pending/{pending_id}/categorize")
async def categorize_pending_tx(pending_id: int, body: CategorizeIn, email: str = Depends(get_current_user)):
    result = await categorize_pending(pending_id, email, body.tipo, body.concepto)
    await _broadcast()
    return result


# ── Atajo iOS (token permanente, sin JWT) ────────────────────────────────────

@app.post("/api/shortcut/pending")
async def shortcut_create_pending(request: Request):
    """Atajo iOS: guarda un gasto pendiente usando el token permanente del usuario.
    No requiere abrir la app — el usuario categoriza después desde la campana."""
    try:
        data = await request.json()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Body inválido: {e}")

    token = data.get("shortcut_token") or data.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="shortcut_token requerido")

    email = await get_email_by_shortcut_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Token inválido")

    try:
        raw = data.get("importe") or data.get("amount") or data.get("Importe")
        importe = float(str(raw).replace(",", ".").replace(" ", ""))
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"importe invalido: recibido={data}")

    if importe <= 0:
        raise HTTPException(status_code=422, detail="importe debe ser mayor que 0")

    result = await create_pending(email, importe)
    await _broadcast()  # la PWA recibe SSE y actualiza la campana en tiempo real
    return result


# ── Recurrentes / Suscripciones ───────────────────────────────────────────────

@app.get("/api/recurring")
async def recurring_expenses(email: str = Depends(get_current_user)):
    """Detecta gastos recurrentes (suscripciones) en el historial del usuario."""
    try:
        return await get_recurring(email)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    if not CRON_SECRET or secret != CRON_SECRET:
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


# ── Inversiones ───────────────────────────────────────────────────────────────

@app.get("/api/investments/prices")
async def investment_prices():
    try:
        return await get_all_prices()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Premium / Revolut ─────────────────────────────────────────────────────────

@app.get("/api/premium/status")
async def premium_status(email: str = Depends(get_current_user)):
    return {"is_premium": await is_premium(email)}


async def _require_premium(email: str):
    if not await is_premium(email):
        raise HTTPException(status_code=402, detail="Esta función es Premium")


class RevolutConnectIn(BaseModel):
    redirect_url: str


# Mensaje único y sencillo para cualquier fallo de Revolut: nunca se le
# enseña al usuario un detalle técnico (nombres de variables de entorno, etc.).
_REVOLUT_GENERIC_ERROR = "No se pudo conectar con tu banco ahora mismo. Inténtalo más tarde."


@app.get("/api/revolut/available")
async def revolut_available_endpoint():
    """Sin autenticar: para que el frontend oculte la función entera si no
    está lista, en vez de dejar que el usuario la intente y falle."""
    return {"available": revolut_is_configured()}


@app.get("/api/revolut/connection")
async def revolut_connection_endpoint(email: str = Depends(get_current_user)):
    conn = await get_connection(email)
    if not conn:
        return {"status": "disconnected"}
    return conn


@app.post("/api/revolut/connect")
async def revolut_connect_endpoint(body: RevolutConnectIn, email: str = Depends(get_current_user)):
    await _require_premium(email)
    try:
        return await revolut_connect(email, body.redirect_url)
    except RevolutNotConfigured:
        raise HTTPException(status_code=503, detail=_REVOLUT_GENERIC_ERROR)


@app.post("/api/revolut/confirm")
async def revolut_confirm_endpoint(email: str = Depends(get_current_user)):
    await _require_premium(email)
    try:
        return await revolut_confirm(email)
    except RevolutNotConfigured:
        raise HTTPException(status_code=503, detail=_REVOLUT_GENERIC_ERROR)


@app.post("/api/revolut/sync")
async def revolut_sync_endpoint(email: str = Depends(get_current_user)):
    await _require_premium(email)
    try:
        result = await revolut_sync(email)
    except RevolutNotConfigured:
        raise HTTPException(status_code=503, detail=_REVOLUT_GENERIC_ERROR)
    await _broadcast()
    return result


@app.delete("/api/revolut/connection")
async def revolut_disconnect_endpoint(email: str = Depends(get_current_user)):
    await revolut_disconnect(email)
    return {"status": "ok"}


# ── Debug ─────────────────────────────────────────────────────────────────────

@app.get("/api/debug/transactions")
async def debug_transactions(email: str = Depends(get_current_user)):
    try:
        return await get_raw_transactions(email)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
