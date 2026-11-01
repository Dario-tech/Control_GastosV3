import os
import hmac
import math
import asyncio
import json as json_lib
import logging
import re
from datetime import date as date_type
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Depends, Query, Path
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response
from typing import Any, Annotated
from pydantic import BaseModel, Field, field_validator, AfterValidator
from dotenv import load_dotenv
# Carga backend/.env si existe (no pisa variables ya definidas, así que en Render/Docker no cambia nada).
# Debe ejecutarse antes de importar los servicios, que leen el entorno al importarse.
load_dotenv()

from services.sheets import (
    get_finance_data, delete_transaction, post_transaction,
    ensure_comentario_column, update_transaction_comment, ensure_encrypted_columns,
    update_transaction,
    ensure_search_index, search_transactions, ensure_id_cliente,
)
from services.auth import (
    verify_google_token, create_jwt, get_current_user, get_current_claims,
    hash_password, verify_password, ensure_revoked_sessions_table, revoke_session,
)
from services.users import (
    get_user, ensure_user, get_email_by_shortcut_token, get_or_create_shortcut_token,
    ensure_password_column, get_password_hash, create_user_with_password,
    registration_open, registro_cerrado_error,
)
from services.db import init_pool, run_in_thread
from services import user_data
from services import legacy_plain
from services.ratelimit import enforce, reset as ratelimit_reset, client_ip
from services.pending import (
    create_pending, get_pending, categorize_pending, delete_pending,
    create_pending_dedup, ensure_wallet_schema,
    ensure_pending_importe_schema, backfill_pending_importe,
)
from services.wallet import (
    parse_importe, parse_fecha, today_madrid, clean_comercio, clean_id_externo,
)
from services.recurring import get_recurring
from services.importes import IMPORTE_MAX, redondear_importe, validar_importe
from services.ai_categorize import suggest_emoji
from services.email_report import send_monthly_report, send_monthly_reports_to_all
from services.goals import (
    ensure_goals_tables, get_goals_for_user, create_goal, update_goal,
    delete_goal, contribute, delete_contribution, share_goal, get_contribution_foto,
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
    ensure_revoked_sessions_table()  # migración aditiva idempotente (sesiones revocadas) + carga en memoria
    ensure_goals_tables()     # migración aditiva idempotente (metas de ahorro compartidas)
    ensure_comentario_column()  # migración aditiva idempotente (comentario libre en transacciones)
    ensure_encrypted_columns()  # migración aditiva idempotente (concepto/importe cifrados)
    ensure_annual_expenses_table()  # migración aditiva idempotente (gastos fijos anuales)
    ensure_id_cliente()  # migración aditiva idempotente (id_cliente: idempotencia del alta)
    ensure_search_index()  # migración aditiva idempotente (índice para paginar la búsqueda)
    ensure_wallet_schema()  # migración aditiva idempotente (Atajo de Cartera: comercio, reglas)
    ensure_pending_importe_schema()  # migración aditiva idempotente (importe de pendientes cifrado)
    backfill_pending_importe()  # cifra pendientes antiguos sin tocar el claro; nunca rompe el arranque
    user_data.ensure_user_data_schema()  # migración aditiva idempotente (categorías y prefs por usuario)
    # TEMPORAL (B2, hasta la fase 3 de MIGRACION_QA_A_PROD.md): si la tabla aún
    # tiene concepto/importe en claro (PROD), las escrituras los rellenan también.
    legacy_plain.detect_plain_columns()
    yield


def _docs_enabled() -> bool:
    """/docs, /redoc y /openapi.json solo con ENABLE_DOCS=true|1|yes (por defecto apagados)."""
    return os.getenv("ENABLE_DOCS", "").strip().lower() in ("true", "1", "yes")


_DOCS = _docs_enabled()
app = FastAPI(
    title="Control Gastos API", version="3.0.0", lifespan=lifespan,
    docs_url="/docs" if _DOCS else None,
    redoc_url="/redoc" if _DOCS else None,
    openapi_url="/openapi.json" if _DOCS else None,
)

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

@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError):
    """422 sin devolver el valor enviado (puede ser un nombre o importe del usuario
    o contener caracteres que no se pueden serializar, p. ej. sustitutos sueltos)."""
    errors = [{"loc": list(e.get("loc", ())), "msg": str(e.get("msg", "")), "type": e.get("type", "")}
              for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


@app.exception_handler(RecursionError)
async def _recursion_handler(request: Request, exc: RecursionError):
    """JSON con anidado extremo: entrada inválida del cliente, no un fallo del servidor."""
    return JSONResponse(status_code=422, content={"detail": "JSON inválido"})


USERDATA_MAX_BODY = 128 * 1024
_USERDATA_PREFIXES = ("/api/categories", "/api/prefs")
GLOBAL_MAX_BODY = 64 * 1024        # tope por defecto en /api/*
SHORTCUT_MAX_BODY = 4 * 1024       # atajo iOS: sin JWT, se corta antes de leer/validar el token
CONTRIBUTE_MAX_BODY = 1_200_000    # aportación de meta con foto (≤ 800.000 caracteres de data-URL)
_CONTRIBUTE_RE = re.compile(r"^/api/goals/[^/]+/contribute/?$")


def _max_body_for(path: str) -> int | None:
    """Tope de cuerpo (bytes) según la ruta; None = sin tope (fuera de /api/)."""
    if not path.startswith("/api/"):
        return None
    if path.startswith(_USERDATA_PREFIXES):
        return USERDATA_MAX_BODY
    if path.rstrip("/") == "/api/shortcut/pending":
        return SHORTCUT_MAX_BODY
    if _CONTRIBUTE_RE.match(path):
        return CONTRIBUTE_MAX_BODY
    return GLOBAL_MAX_BODY


class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """Tope de tamaño de cuerpo en /api/* (64 KB por defecto; 4 KB en el atajo; 128 KB
    en categorías/prefs; ~1,2 MB en aportaciones con foto). Mira Content-Length y además
    cuenta los bytes según llegan (cubre `Transfer-Encoding: chunked`), cortando en
    cuanto se supera el límite, sin acumular el cuerpo en memoria."""

    def __init__(self, app, max_bytes: int | None = None):
        self.app = app
        self.max_bytes = max_bytes   # fuerza un tope único en /api/* (pruebas)

    async def __call__(self, scope, receive, send):
        limit = _max_body_for(scope["path"]) if scope["type"] == "http" else None
        if limit is not None and self.max_bytes:
            limit = self.max_bytes
        if limit is None:
            return await self.app(scope, receive, send)
        self_max = limit
        too_big = JSONResponse(
            status_code=413,
            content={"detail": f"Cuerpo demasiado grande (máx. {limit // 1024} KB)"},
        )
        try:
            declared = int(dict(scope["headers"]).get(b"content-length") or 0)
        except ValueError:
            declared = 0
        if declared > self_max:
            return await too_big(scope, receive, send)

        seen = 0
        started = False   # ya se envió alguna respuesta (la nuestra o la de la app)
        rejected = False  # enviamos el 413 nosotros; se descarta lo que la app intente enviar después

        async def limited_receive():
            nonlocal seen, started, rejected
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > self_max:
                    # Se responde 413 aquí mismo: FastAPI convierte cualquier fallo al leer
                    # el cuerpo en un 400, así que no se puede confiar en que la excepción llegue.
                    if not started:
                        started = rejected = True
                        await too_big(scope, receive, send)
                    raise _BodyTooLarge()
            return msg

        async def tracking_send(msg):
            nonlocal started
            if rejected:
                return
            started = True
            await send(msg)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if not rejected:
                raise


class SecurityHeadersMiddleware:
    """Cabeceras de seguridad en todas las respuestas (incluidos 4xx y el 413 del tope
    de cuerpo, que pasan por aquí) y `Cache-Control: no-store` en /api/* salvo
    /api/health y el stream /api/events, que conservan el suyo. También convierte un
    error no controlado en el 500 genérico DENTRO de la cadena, para que ese 500 lleve
    CORS y estas cabeceras (el handler de Exception de Starlette queda fuera de ambos)."""

    _FIJAS = ((b"x-content-type-options", b"nosniff"),
              (b"referrer-policy", b"no-referrer"),
              (b"x-frame-options", b"DENY"))
    _SIN_NOSTORE = ("/api/health", "/api/events")

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        no_store = path.startswith("/api/") and path.rstrip("/") not in self._SIN_NOSTORE
        started = False

        async def send_wrapper(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                # Una ruta puede declarar su propia caché PRIVADA (p. ej. la foto de una
                # aportación: private, max-age=3600); esa se respeta. Todo lo demás: no-store.
                propia = any(k.lower() == b"cache-control" and v.lower().startswith(b"private")
                             for k, v in message.get("headers", []))
                pisar = no_store and not propia
                nombres = {n for n, _ in self._FIJAS} | ({b"cache-control"} if pisar else set())
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in nombres]
                headers += list(self._FIJAS)
                if pisar:
                    headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            if started:
                raise
            _log.error("Error no controlado en %s %s", scope.get("method"), path, exc_info=exc)
            resp = JSONResponse(status_code=500, content={"detail": "Error interno del servidor"})
            await resp(scope, receive, send_wrapper)


# Orden (de fuera adentro): CORS > GZip > cabeceras de seguridad > tope de cuerpo > app.
# Así el 413 y cualquier 4xx/5xx llevan cabeceras de seguridad y CORS.
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


class GZipExceptSSE:
    """GZip para las respuestas JSON grandes (/api/finance, /api/goals...), SALVO el
    stream SSE: GZipMiddleware acumula bytes en su compresor y no los vacía hasta
    cerrar, lo que retendría los eventos indefinidamente. /api/events pasa tal cual.
    Orden: va por dentro de CORS (se añade antes), así la respuesta comprimida sale
    con las cabeceras CORS; y por fuera del tope de cuerpo (el 413 también se comprime
    si procede). nivel 5: 9 es mucha CPU para el plan gratuito y apenas gana tamaño."""

    def __init__(self, app, minimum_size: int = 1024):
        self.app = app
        self._gzip = GZipMiddleware(app, minimum_size=minimum_size, compresslevel=5)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] == "/api/events":
            return await self.app(scope, receive, send)
        return await self._gzip(scope, receive, send)


app.add_middleware(GZipExceptSSE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "DELETE", "POST", "PATCH", "PUT"],
    allow_headers=["*"],
)

_sse_clients: set[asyncio.Queue] = set()


# ── Auth ──────────────────────────────────────────────────────────────────────

def _has_surrogates(s: str, multiline: bool = False) -> bool:
    """Texto no apto: sustitutos Unicode sueltos (U+D800-U+DFFF; JSON los admite pero no se
    pueden codificar en UTF-8) o caracteres de control C0/DEL (sobre todo NUL, que Postgres
    no admite en columnas de texto). Con multiline=True se permiten salto de línea,
    retorno de carro y tabulador."""
    permitidos = (9, 10, 13) if multiline else ()
    for ch in s:
        o = ord(ch)
        if 0xD800 <= o <= 0xDFFF or ((o < 32 or o == 127) and o not in permitidos):
            return True
    return False


def _texto_valido(v: str) -> str:
    if _has_surrogates(v):
        raise ValueError("Texto inválido")
    return v


def _password_valida(v: str) -> str:
    # Contraseñas: solo se rechaza lo que rompería (NUL y sustitutos); no se bloquean
    # cuentas antiguas cuya contraseña tenga un tabulador u otro control.
    if "\x00" in v or any(0xD800 <= ord(ch) <= 0xDFFF for ch in v):
        raise ValueError("Texto inválido")
    return v


Txt = Annotated[str, AfterValidator(_texto_valido)]  # str sin sustitutos sueltos ni controles
TxtPw = Annotated[str, AfterValidator(_password_valida)]


class GoogleLoginIn(BaseModel):
    token: Txt = Field(max_length=4096)


@app.post("/api/auth/login")
async def auth_login(body: GoogleLoginIn, request: Request):
    """Verifica el token de Google y auto-registra al usuario si es nuevo."""
    # 20 intentos/min por IP; al superarlo, bloqueo de 5 min
    enforce("google-login-ip", [client_ip(request)], limit=20, window=60, block=300)
    google_user   = await verify_google_token(body.token)
    email         = google_user["email"]
    name          = google_user.get("name") or email.split("@")[0]
    await ensure_user(email, name)
    session_token = create_jwt(email)
    return {
        "session_token": session_token,
        "needs_setup":   False,
        "user": {
            "email":          email,
            "name":           name,
            "picture":        google_user.get("picture", ""),
        },
    }


@app.get("/api/auth/me")
async def auth_me(email: str = Depends(get_current_user)):
    user = await get_user(email)
    return {"email": email, "name": (user or {}).get("name", "")}


@app.post("/api/auth/logout")
async def auth_logout(claims: dict = Depends(get_current_claims)):
    """Revoca la sesión (jti) del JWT actual: desde ese momento ese token da 401.
    Responde 200 {"status": "ok"}. Un token antiguo sin jti no se puede revocar: se
    responde igualmente 200 (el cliente debe olvidarlo) con "revoked": false."""
    jti = claims.get("jti")
    if not isinstance(jti, str) or not jti:
        return {"status": "ok", "revoked": False}
    await run_in_thread(lambda: revoke_session(jti, float(claims["exp"])))
    return {"status": "ok", "revoked": True}


# ── Auth por email + contraseña ───────────────────────────────────────────────

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_EMAIL_MAX = 254
_NAME_MAX = 100
_PASSWORD_MIN, _PASSWORD_MAX = 10, 128


class RegisterIn(BaseModel):
    # Tope de transporte generoso; los topes reales (con mensaje) se validan en el endpoint.
    email:    Txt = Field(max_length=1024)
    name:     Txt = Field(max_length=1024)
    password: TxtPw = Field(max_length=1024)


class EmailLoginIn(BaseModel):
    email:    Txt = Field(max_length=1024)
    password: TxtPw = Field(max_length=1024)  # sin el máximo de 128 del alta: no bloquear cuentas antiguas


def _session_response(email: str, name: str) -> dict:
    # No incluye shortcut_token: se obtiene solo por GET /api/shortcut/token (JWT).
    return {
        "session_token": create_jwt(email),
        "needs_setup":   False,
        "user": {
            "email":          email,
            "name":           name,
            "picture":        "",
        },
    }


@app.post("/api/auth/register")
async def auth_register(body: RegisterIn, request: Request):
    """Alta con email + contraseña. Con el registro cerrado (ALLOW_REGISTER no es
    true/1/yes, lo habitual) responde 403 siempre, exista o no el email."""
    # 5 registros/10 min por IP (bloqueo 15 min); 3/10 min por email
    enforce("reg-ip", [client_ip(request)], limit=5, window=600, block=900)
    if not registration_open():
        raise registro_cerrado_error()

    email = body.email.strip().lower()
    name  = body.name.strip() or email.split("@")[0]

    if len(email) > _EMAIL_MAX or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Email no válido")
    if len(name) > _NAME_MAX:
        raise HTTPException(status_code=422, detail=f"El nombre no puede superar {_NAME_MAX} caracteres")
    if len(body.password) < _PASSWORD_MIN:
        raise HTTPException(status_code=422, detail="La contraseña debe tener al menos 10 caracteres")
    if len(body.password) > _PASSWORD_MAX:
        raise HTTPException(status_code=422, detail=f"La contraseña no puede superar {_PASSWORD_MAX} caracteres")
    enforce("reg-email", [email], limit=3, window=600, block=900)

    pw_hash = await asyncio.to_thread(hash_password, body.password)  # bcrypt fuera del event loop
    created = await create_user_with_password(email, name, pw_hash)
    if created is None:
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con este email")

    return _session_response(email, created["name"])


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
        await asyncio.to_thread(verify_password, body.password, _DUMMY_PASSWORD_HASH)
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")
    if not await asyncio.to_thread(verify_password, body.password, pw_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")
    # Login correcto: los aciertos no cuentan para el límite por email (el de IP se mantiene)
    ratelimit_reset("login-email", email)

    user = await get_user(email)
    return _session_response(email, (user or {}).get("name", ""))


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
    source:     Txt = Field(default="shortcut", max_length=32)
    comentario: str | None = None
    id_cliente: str | None = Field(default=None, max_length=64)  # opcional, idempotencia (ver add_transaction)


_ID_CLIENTE_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,64}$")
_ID_EXTERNO_MAX = 128


@app.post("/api/transaction")
async def add_transaction(request: Request, email: str = Depends(get_current_user)):
    """Crea un movimiento. Body: {importe, tipo, concepto, fecha?, source?, comentario?, id_cliente?}.

    Idempotencia (opcional): el cliente genera un `id_cliente` (p. ej. un UUID, 8-64
    caracteres de [A-Za-z0-9_.:-]) al abrir el formulario y lo reenvía idéntico en cada
    reintento del mismo alta. Si ya existe un movimiento del usuario con ese id, NO se
    crea otro: se responde 200 con el existente {"status":"ok","id","fecha","duplicada":true}.
    En el primer envío la respuesta es la de siempre (sin "duplicada"). Sin id_cliente el
    comportamiento no cambia. Un id_cliente con formato inválido responde 422.
    """
    raw = await request.body()
    try:
        data = json_lib.loads(raw)
        if isinstance(data, str):
            data = json_lib.loads(data)
        tx = TransactionIn(**data)
    except Exception:
        raise HTTPException(status_code=422, detail="Body inválido")
    # Mismo tope y redondeo que el PATCH: ≥ 1e8 desbordaría `importe NUMERIC(10,2)`
    # en PROD (doble escritura B2) y daría 502. Sin eco del valor en el 422.
    try:
        if isinstance(data.get("importe"), bool):
            raise ValueError
        importe = validar_importe(tx.importe)
    except ValueError:
        _err422("El importe debe ser mayor que 0 y no superar 1.000.000")
    if tx.id_cliente is not None and not _ID_CLIENTE_RE.match(tx.id_cliente):
        _err422("id_cliente inválido")
    # tipo (3 valores), concepto 1..60, comentario ≤500, fecha real entre 2000-01-01 y
    # hoy+1 año y sin sustitutos Unicode: las mismas reglas (y mensajes 422) que el PATCH.
    campos = {"tipo": tx.tipo, "concepto": tx.concepto}
    if tx.fecha is not None:
        campos["fecha"] = tx.fecha
    if tx.comentario is not None:
        campos["comentario"] = tx.comentario
    ok = _validate_tx_patch(campos)

    try:
        result = await post_transaction(
            importe, ok["tipo"], ok["concepto"], email, tx.source, ok.get("fecha"),
            ok.get("comentario") or None, id_cliente=tx.id_cliente,
        )
    except HTTPException:
        raise
    except Exception:
        _log.exception("Error en POST /api/transaction")
        raise HTTPException(status_code=502, detail="Error al guardar la transacción")

    await _broadcast()
    return result


class CommentIn(BaseModel):
    comentario: str = Field(max_length=4 * 500)  # transporte; el tope real (500, tras strip) lo valida el endpoint


@app.patch("/api/transactions/{row_index}/comment")
async def update_transaction_comment_endpoint(
    row_index: int, body: CommentIn, email: str = Depends(get_current_user)
):
    comentario = _validate_tx_patch({"comentario": body.comentario})["comentario"]  # ≤500, sin sustitutos
    try:
        result = await update_transaction_comment(row_index, email, comentario)
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
_IMPORTE_MAX    = IMPORTE_MAX  # services/importes.py
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
        # Hasta el fin del año que viene (como antes); nunca 2000-01-01 hacia atrás.
        limite = date_type(date_type.today().year + 1, 12, 31)
        if d < date_type(2000, 1, 1) or d > limite:
            _err422(f"La fecha debe estar entre 2000-01-01 y {limite.isoformat()}")
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
        try:
            v = redondear_importe(v)  # céntimos, ROUND_HALF_UP (antes de cifrar)
        except ValueError:  # finito pero enorme (≥ 1e26): no se puede cuantizar
            _err422("El importe no puede superar 1.000.000")
        if v <= 0:
            _err422("El importe debe ser mayor que 0")
        if v > _IMPORTE_MAX:
            _err422("El importe no puede superar 1.000.000")
        changes["importe"] = v

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
        if _has_surrogates(c):
            _err422("Texto inválido")
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
        if _has_surrogates(cm, multiline=True):
            _err422("Texto inválido")
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
    if not isinstance(data, dict) or _dict_has_surrogates(data):
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
    tipo:       str = Field(max_length=64)
    concepto:   str = Field(max_length=1024)   # transporte; el tope real (60) lo valida el endpoint
    recordar:   bool = True         # aprender la regla comercio → categoría
    comentario: str | None = Field(default=None, max_length=4 * 500)   # ≤ 500, se guarda en la transacción creada


@app.post("/api/pending/{pending_id}/categorize")
async def categorize_pending_tx(pending_id: int, body: CategorizeIn, email: str = Depends(get_current_user)):
    campos = {"tipo": body.tipo, "concepto": body.concepto}
    if body.comentario is not None:
        campos["comentario"] = body.comentario
    ok = _validate_tx_patch(campos)   # tipo válido, concepto 1..60, comentario ≤500, sin sustitutos
    result = await categorize_pending(
        pending_id, email, ok["tipo"], ok["concepto"],
        recordar=body.recordar, comentario=ok.get("comentario") or None,
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

SHORTCUT_MAX_IMPORTE = IMPORTE_MAX  # services/importes.py
_SHORTCUT_TOKEN_MAX = 128


def _dict_has_surrogates(data: dict) -> bool:
    # multiline=True: el nombre de un comercio de Apple Pay puede traer saltos de línea
    # o tabuladores; clean_comercio los colapsa después. Rechazar la petición entera
    # por eso perdería el pago. NUL, sustitutos y el resto de controles siguen fuera.
    return any(isinstance(v, str) and _has_surrogates(v, multiline=True) for v in data.values())

@app.get("/api/shortcut/token")
async def shortcut_get_token(email: str = Depends(get_current_user)):
    """Devuelve el shortcut_token permanente del usuario autenticado (JWT) para
    configurar el Atajo de iOS en segundo plano. Si aún no tiene (copia antigua con
    NULL) se genera uno seguro y se guarda sin pisar uno concurrente. Respuesta:
    {"shortcut_token": "..."} con Cache-Control: no-store. El token nunca se registra."""
    enforce("shortcut-token", [email], limit=20, window=3600, block=3600)
    token = await get_or_create_shortcut_token(email)
    if not token:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return JSONResponse({"shortcut_token": token}, headers={"Cache-Control": "no-store"})


@app.post("/api/shortcut/pending")
async def shortcut_create_pending(request: Request):
    """Atajo iOS: guarda un gasto pendiente usando el token permanente del usuario.
    No requiere abrir la app — el usuario categoriza después desde la campana.

    Body: {shortcut_token (o token), importe, fecha?, comercio?, id_externo?}.
    - importe: número o texto de Cartera ("12,40 €", "12,4", "1.234,56 €"); mismo
      parser que /api/pending. 422 "importe inválido" si no se entiende, es <= 0 o
      supera el tope.
    - fecha: AAAA-MM-DD; si falta o no se entiende, hoy en Europe/Madrid.
    - comercio (opcional): texto; se recorta y se limita a 120 caracteres; si no es
      texto o queda vacío se ignora. Se guarda cifrado en el pendiente.
    - id_externo (opcional): texto <= 128 caracteres (UUID o fecha-hora del disparo).
    Con comercio y/o id_externo se deduplican reintentos (mismo id_externo en 24 h, o
    mismo importe+comercio en < 2 min) con create_pending_dedup: 200 con el existente
    y "duplicada": true. Respuesta en ese caso, recortada a propósito (no filtra
    comercio, importe ni categorías aprendidas): {id, duplicada}. Sin comercio ni id_externo (Atajos antiguos) la respuesta
    es la de siempre: {id, importe, fecha}. Nunca se registra comercio ni importe."""
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("el body debe ser un objeto JSON")
    except Exception:
        raise HTTPException(status_code=422, detail="Body inválido")

    token = data.get("shortcut_token") or data.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="shortcut_token requerido")
    # Tipo/longitud ANTES de limitar y consultar la BD: nunca un 500 por un token raro.
    if not isinstance(token, str) or len(token) > _SHORTCUT_TOKEN_MAX or _has_surrogates(token):
        raise HTTPException(status_code=401, detail="Token inválido")
    if _dict_has_surrogates(data):
        raise HTTPException(status_code=422, detail="Body inválido")
    # Se cuenta ANTES de consultar la BD: por IP del cliente (frena el tanteo de tokens
    # distintos desde un mismo origen) y por token (30/min; frena un Atajo en bucle).
    # Con token inválido también cuenta, porque el límite se aplica antes de validarlo.
    enforce("shortcut-ip", [client_ip(request)], limit=60, window=60, block=300)
    enforce("shortcut", [str(token)], limit=30, window=60, block=300)

    email = await get_email_by_shortcut_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Token inválido")

    raw = data.get("importe") or data.get("amount") or data.get("Importe")
    try:
        importe = parse_importe(raw, SHORTCUT_MAX_IMPORTE)  # céntimos, ROUND_HALF_UP, > 0 y <= tope
    except ValueError:
        # Mensajes antiguos para importes numéricos (compatibilidad); texto: genérico.
        detail = "importe inválido"
        if isinstance(raw, (int, float)) and not isinstance(raw, bool) and math.isfinite(raw):
            if raw > SHORTCUT_MAX_IMPORTE:
                detail = "importe demasiado alto"
            else:
                try:
                    if redondear_importe(raw) <= 0:
                        detail = "importe debe ser mayor que 0"
                except ValueError:
                    pass
        raise HTTPException(status_code=422, detail=detail)

    # Fecha recibida si es válida; si falta o no se entiende, HOY en Europe/Madrid
    # (no CURRENT_DATE de la BD, que va en UTC). Se tolera un formato desconocido
    # por compatibilidad con Atajos antiguos que nunca enviaron fecha.
    try:
        fecha = parse_fecha(data.get("fecha"))
    except ValueError:
        fecha = today_madrid()

    comercio = clean_comercio(data.get("comercio"))
    id_externo = data.get("id_externo")
    if id_externo is not None:
        if not isinstance(id_externo, str) or not id_externo.strip() or len(id_externo) > _ID_EXTERNO_MAX:
            raise HTTPException(status_code=422, detail="id_externo inválido")
        id_externo = id_externo.strip()

    if comercio is not None or id_externo is not None:
        full = await create_pending_dedup(email, importe, fecha.isoformat(), comercio,
                                          id_externo, fuente="atajo")
        result = {"id": full["id"], "duplicada": bool(full.get("duplicada"))}
    else:
        result = await create_pending(email, importe, fecha.isoformat(), fuente="atajo")
    if not (isinstance(result, dict) and result.get("duplicada")):
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
    nombre: str = Field(max_length=60)  # >60 caracteres: 422 (acota el coste del prompt)


@app.post("/api/categorize/suggest-emoji")
async def suggest_emoji_endpoint(body: EmojiSuggestIn, email: str = Depends(get_current_user)):
    """Sugiere un emoji para una categoría nueva a partir de su nombre (Claude API)."""
    # Cada llamada cuesta dinero: 20/hora por usuario (bloqueo 1 h al superarlo).
    enforce("emoji-user", [email], limit=20, window=3600, block=3600)
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

_GOAL_NOMBRE_MAX = 60
_GOAL_EMOJI_MAX = 16
_GOAL_URL_MAX = 2048
_GOAL_OBJETIVO_MAX = 100_000_000


class GoalIn(BaseModel):
    # Topes de transporte generosos; los reales (con mensaje claro) los aplica _validate_goal.
    nombre:     Txt = Field(max_length=1024)
    objetivo:   float
    emoji:      Txt = Field(default="🎯", max_length=1024)
    fecha:      str | None = Field(default=None, max_length=64)
    imagen_url: Txt | None = Field(default=None, max_length=8192)  # gif/imagen personalizada, alternativa al emoji


def _validate_goal(body: "GoalIn") -> tuple[str, float, str, str | None, str | None]:
    """Valida y normaliza nombre (1..60), objetivo (finito, >0, ≤100.000.000), emoji
    (≤16), fecha (AAAA-MM-DD real, 2000..2100; vacía = sin fecha) e imagen_url
    (≤2048, http/https). 422 con mensaje; devuelve (nombre, objetivo, emoji, fecha, url)."""
    nombre = body.nombre.strip()
    if not nombre:
        _err422("Escribe un nombre")
    if len(nombre) > _GOAL_NOMBRE_MAX:
        _err422(f"El nombre no puede superar {_GOAL_NOMBRE_MAX} caracteres")
    try:
        objetivo = redondear_importe(body.objetivo)   # finito; céntimos
    except ValueError:
        _err422("El objetivo debe ser un número finito")
    if objetivo <= 0:
        _err422("El objetivo debe ser mayor que 0")
    if objetivo > _GOAL_OBJETIVO_MAX:
        _err422("El objetivo no puede superar 100.000.000")
    emoji = body.emoji.strip() or "🎯"
    if len(emoji) > _GOAL_EMOJI_MAX:
        _err422(f"El emoji no puede superar {_GOAL_EMOJI_MAX} caracteres")
    fecha = (body.fecha or "").strip() or None
    if fecha is not None:
        if not _FECHA_RE.match(fecha):
            _err422("La fecha debe tener el formato AAAA-MM-DD")
        try:
            d = date_type.fromisoformat(fecha)
        except ValueError:
            _err422("La fecha no es válida")
        if not (2000 <= d.year <= 2100):
            _err422("El año de la fecha debe estar entre 2000 y 2100")
        fecha = d.isoformat()
    return nombre, objetivo, emoji, fecha, _clean_imagen_url(body.imagen_url)


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
    email: Txt = Field(max_length=_EMAIL_MAX)


@app.get("/api/goals")
async def list_goals_endpoint(email: str = Depends(get_current_user)):
    return await get_goals_for_user(email)


def _clean_imagen_url(raw: str | None) -> str | None:
    url = (raw or "").strip()
    if not url:
        return None
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=422, detail="La URL de la imagen debe empezar por http:// o https://")
    if len(url) > _GOAL_URL_MAX:
        raise HTTPException(status_code=422, detail=f"La URL de la imagen no puede superar {_GOAL_URL_MAX} caracteres")
    return url


@app.post("/api/goals")
async def create_goal_endpoint(body: GoalIn, email: str = Depends(get_current_user)):
    nombre, objetivo, emoji, fecha, imagen_url = _validate_goal(body)
    return await create_goal(email, nombre, objetivo, emoji, fecha, imagen_url)


@app.patch("/api/goals/{goal_id}")
async def update_goal_endpoint(goal_id: int, body: GoalIn, email: str = Depends(get_current_user)):
    nombre, objetivo, emoji, fecha, imagen_url = _validate_goal(body)
    return await update_goal(goal_id, email, nombre, objetivo, emoji, fecha, imagen_url)


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


@app.get("/api/goals/{goal_id}/contributions/{contribution_id}/foto")
async def contribution_foto_endpoint(goal_id: int, contribution_id: int, email: str = Depends(get_current_user)):
    """Foto de una aportación (fuera de GET /api/goals por su tamaño). Solo miembros
    de la meta; 404 uniforme si no existe o no se es miembro. Convención de caché:
    esta ruta fija su propio Cache-Control (private: es contenido de un usuario; 1 h:
    una foto de aportación no cambia, y si se borra la aportación el id ya no se pide).
    Una cabecera global no-store en /api/* debe respetar un Cache-Control ya presente
    (setdefault), no pisarlo."""
    foto = await get_contribution_foto(goal_id, contribution_id, email)
    return JSONResponse({"foto": foto}, headers={"Cache-Control": "private, max-age=3600"})


@app.post("/api/goals/{goal_id}/share")
async def share_goal_endpoint(goal_id: int, body: ShareIn, email: str = Depends(get_current_user)):
    """Comparte una meta con otra cuenta por email.

    Limitación conocida: el invitado se añade sin aceptación y `members` lo incluye, así que
    la respuesta permite saber si un email tiene cuenta (enumeración). Mitigación actual:
    límite por usuario (10/hora y 30/día, 429). La solución completa es un flujo de
    invitaciones con aceptación (respuesta uniforme, el invitado entra al aceptar).
    """
    enforce("share-hour", [email], limit=10, window=3600, block=3600)
    enforce("share-day", [email], limit=30, window=86400, block=3600)
    return await share_goal(goal_id, email, body.email)


# ── Gastos fijos anuales (IBI, seguro del coche…) ────────────────────────────

_ANNUAL_NOMBRE_MAX = 60


class AnnualExpenseIn(BaseModel):
    nombre:        Txt = Field(max_length=1024)   # tope real (60) en _validate_annual_expense
    importe:       float
    mes:           int
    dia:           int = 1
    meses_reparto: list[int] | None = Field(default=None, max_length=64)
    avisar:        bool = True
    dias_aviso:    int = 15


def _validate_annual_expense(body: "AnnualExpenseIn"):
    if not body.nombre.strip():
        raise HTTPException(status_code=422, detail="Escribe un nombre")
    if len(body.nombre.strip()) > _ANNUAL_NOMBRE_MAX:
        raise HTTPException(status_code=422, detail=f"El nombre no puede superar {_ANNUAL_NOMBRE_MAX} caracteres")
    if not (0 <= body.dias_aviso <= 365):
        raise HTTPException(status_code=422, detail="Los días de aviso deben estar entre 0 y 365")
    try:
        body.importe = validar_importe(body.importe)  # > 0, ≤ 1.000.000, céntimos
    except ValueError:
        raise HTTPException(status_code=422, detail="El importe debe ser mayor que 0 y no superar 1.000.000")
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

CategoryId = Annotated[int, Path(ge=1, le=2**63 - 1)]  # rango bigint de la BD


class CategoryIn(BaseModel):
    tipo: str = Field(max_length=32)
    concepto: str = Field(max_length=200)   # antes de normalizar; el tope real (40) lo aplica el servicio
    emoji: str | None = Field(default=None, max_length=64)


class CategoryPatchIn(BaseModel):
    concepto: str | None = Field(default=None, max_length=200)
    emoji: str | None = Field(default=None, max_length=64)


class CategoryImportItem(BaseModel):
    tipo: str | None = Field(default=None, max_length=32)
    concepto: str | None = Field(default=None, max_length=200)
    emoji: str | None = Field(default=None, max_length=64)

    @field_validator("tipo", "concepto", "emoji", mode="before")
    @classmethod
    def _solo_texto(cls, v):
        return v if isinstance(v, str) else None   # tipos raros: el servicio lo cuenta como omitido


class CategoryImportIn(BaseModel):
    items: list[CategoryImportItem | None] = Field(max_length=200)

    @field_validator("items", mode="before")
    @classmethod
    def _items_no_objeto(cls, v):
        # Elementos que no son objetos (cadenas, números...) se omiten, no tumban el lote.
        if isinstance(v, list):
            return [x if isinstance(x, dict) else None for x in v]
        return v


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
    return await run_in_thread(lambda: user_data.import_categories(
        email, [i.model_dump() if i else None for i in body.items]))


@app.patch("/api/categories/{category_id}")
async def update_category_endpoint(category_id: CategoryId, body: CategoryPatchIn, email: str = Depends(get_current_user)):
    _limit_user_writes(email)
    return await run_in_thread(lambda: user_data.update_category(email, category_id, body.concepto, body.emoji))


@app.delete("/api/categories/{category_id}", status_code=204)
async def delete_category_endpoint(category_id: CategoryId, email: str = Depends(get_current_user)):
    _limit_user_writes(email)
    await run_in_thread(lambda: user_data.delete_category(email, category_id))
    return Response(status_code=204)


@app.get("/api/prefs")
async def get_prefs_endpoint(email: str = Depends(get_current_user)):
    return await run_in_thread(lambda: user_data.get_prefs(email))


@app.put("/api/prefs/{kind}")
async def put_pref_endpoint(kind: str, request: Request, force: bool = False,
                            email: str = Depends(get_current_user)):
    if kind not in user_data.PREF_KINDS:
        raise HTTPException(status_code=422, detail="kind no permitido")
    _limit_user_writes(email)
    # El tope de cuerpo (128 KB, también chunked) lo aplica BodySizeLimitMiddleware;
    # el tope exacto de 64 KB de JSON se valida en el servicio.
    raw = await request.body()
    try:
        payload = json_lib.loads(raw)
    except (ValueError, RecursionError):
        raise HTTPException(status_code=422, detail="JSON inválido")
    if not isinstance(payload, dict) or "data" not in payload:
        raise HTTPException(status_code=422, detail='Falta el campo "data"')
    return await run_in_thread(lambda: user_data.put_pref(email, kind, payload["data"], force))
