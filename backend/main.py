import os
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from services.prices import get_all_prices
from services.sheets import get_finance_data, get_raw_transactions, delete_transaction

app = FastAPI(title="Control Gastos API", version="1.0.0")

# CORS_ORIGINS en producción: "https://tu-app.vercel.app,https://otro-dominio.com"
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

# Cola de clientes SSE activos
_sse_clients: set[asyncio.Queue] = set()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/events")
async def sse_events():
    """Stream de eventos SSE. El frontend se conecta aquí y recibe 'update' cuando hay datos nuevos."""
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
                    # Keepalive cada 25s para que proxies no cierren la conexión
                    yield "event: ping\ndata: keepalive\n\n"
        finally:
            _sse_clients.discard(q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/notify")
async def notify_update():
    """Webhook que llama Apps Script tras guardar una transacción. Avisa a todos los clientes SSE."""
    clients = list(_sse_clients)
    for q in clients:
        await q.put("data_updated")
    return {"notified": len(clients)}


@app.get("/api/investments/prices")
async def investment_prices():
    try:
        return await get_all_prices()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/finance")
async def finance_data():
    try:
        return await get_finance_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/transactions/{row_index}")
async def delete_transaction_endpoint(row_index: int):
    try:
        return await delete_transaction(row_index)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/debug/transactions")
async def debug_transactions():
    try:
        return await get_raw_transactions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
