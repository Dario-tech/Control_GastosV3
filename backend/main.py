import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
    allow_methods=["GET", "DELETE"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


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
