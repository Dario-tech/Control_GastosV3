import os
import asyncio
import json as json_lib
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.prices import get_all_prices
from services.sheets import get_finance_data, get_raw_transactions, delete_transaction, post_transaction
from services.auth import verify_google_token, create_jwt, get_current_user
from services.users import get_user, get_user_sheet_url, register_user

app = FastAPI(title="Control Gastos API", version="2.0.0")

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
    """Recibe el ID token de Google, lo verifica y devuelve un JWT de sesión.
    Si el usuario es nuevo (sin Sheet), needs_setup=True — el frontend muestra la pantalla de configuración."""
    google_user = verify_google_token(body.token)
    email       = google_user["email"]
    user_info   = await get_user(email)
    session_token = create_jwt(email)
    return {
        "session_token": session_token,
        "needs_setup": user_info is None,
        "user": {
            "email":   email,
            "name":    google_user.get("name") or (user_info or {}).get("name", ""),
            "picture": google_user.get("picture", ""),
        },
    }


class RegisterIn(BaseModel):
    sheet_url: str


@app.post("/api/auth/register")
async def auth_register(body: RegisterIn, email: str = Depends(get_current_user)):
    """Guarda el Sheet URL del usuario nuevo en el Sheet de usuarios."""
    if not body.sheet_url.startswith("https://script.google.com"):
        raise HTTPException(status_code=400, detail="URL de Apps Script inválida")
    user_info = await get_user(email)
    name = (user_info or {}).get("name", email.split("@")[0])
    result = await register_user(email, name, body.sheet_url)
    return {"status": result.get("status"), "email": email}


@app.get("/api/auth/me")
async def auth_me(email: str = Depends(get_current_user)):
    user = await get_user(email)
    return {"email": email, "needs_setup": user is None, "name": (user or {}).get("name", "")}


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
        sheet_url = get_user_sheet_url(email)
        return await get_finance_data(sheet_url)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/transactions/{row_index}")
async def delete_transaction_endpoint(row_index: int, email: str = Depends(get_current_user)):
    try:
        sheet_url = get_user_sheet_url(email)
        return await delete_transaction(row_index, sheet_url)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TransactionIn(BaseModel):
    importe:  float
    tipo:     str
    concepto: str
    source:   str = "shortcut"


@app.post("/api/transaction")
async def add_transaction(request: Request, email: str = Depends(get_current_user)):
    """Recibe una transacción del Atajo iOS, la escribe en el Sheet del usuario y notifica via SSE."""
    raw = await request.body()
    try:
        data = json_lib.loads(raw)
        if isinstance(data, str):
            data = json_lib.loads(data)
        tx = TransactionIn(**data)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Body inválido: {e}")

    try:
        sheet_url = get_user_sheet_url(email)
        result = await post_transaction(tx.importe, tx.tipo, tx.concepto, sheet_url, tx.source)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error al escribir en Sheets: {e}")

    await _broadcast()
    return result


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
        sheet_url = get_user_sheet_url(email)
        return await get_raw_transactions(sheet_url)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
