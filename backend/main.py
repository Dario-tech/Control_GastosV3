import os
import asyncio
import json as json_lib
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.prices import get_all_prices
from services.sheets import get_finance_data, get_raw_transactions, delete_transaction, post_transaction
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    ensure_password_column()  # migración aditiva idempotente (columna password_hash)
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
    allow_methods=["GET", "DELETE", "POST"],
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
    importe:  float
    tipo:     str
    concepto: str
    fecha:    str | None = None  # YYYY-MM-DD; si no se pasa, usa CURRENT_DATE
    source:   str = "shortcut"


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
        result = await post_transaction(tx.importe, tx.tipo, tx.concepto, email, tx.source, tx.fecha)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error al escribir en la base de datos: {e}")

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


# ── Inversiones ───────────────────────────────────────────────────────────────

@app.get("/api/investments/prices")
async def investment_prices():
    try:
        return await get_all_prices()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Debug ─────────────────────────────────────────────────────────────────────

@app.get("/api/debug/transactions")
async def debug_transactions(email: str = Depends(get_current_user)):
    try:
        return await get_raw_transactions(email)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
