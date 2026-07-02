import asyncio
import httpx
import yfinance as yf

# Definición de inversiones — solo lo que el backend necesita para obtener precios
INVESTMENTS = [
    {"id": "vwce", "symbol": "VWCE.DE",  "source": "yahoo"},
    {"id": "iwda", "symbol": "IWDA.AS",  "source": "yahoo"},
    {"id": "cspx", "symbol": "CSPX.AS",  "source": "yahoo"},
    {"id": "btc",  "coin_id": "bitcoin", "source": "coingecko"},
]


def _fetch_yahoo_price(symbol: str) -> dict:
    """Obtiene precio actual via yfinance (sin CORS, sin API key)."""
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="2d")
    if hist.empty:
        raise ValueError(f"Sin datos para {symbol}")
    price = float(hist["Close"].iloc[-1])
    prev  = float(hist["Close"].iloc[-2]) if len(hist) > 1 else price
    change = round(((price - prev) / prev) * 100, 2) if prev else 0.0
    return {"price": round(price, 2), "change": change}


async def _get_coingecko_price(coin_id: str) -> dict:
    url = (
        f"https://api.coingecko.com/api/v3/simple/price"
        f"?ids={coin_id}&vs_currencies=eur&include_24hr_change=true"
    )
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(url)
        res.raise_for_status()
    data = res.json()[coin_id]
    return {
        "price":  round(data["eur"], 2),
        "change": round(data.get("eur_24h_change", 0), 2),
    }


async def get_all_prices() -> dict:
    loop = asyncio.get_event_loop()
    prices = {}

    async def fetch_one(inv: dict):
        try:
            if inv["source"] == "yahoo":
                result = await loop.run_in_executor(None, _fetch_yahoo_price, inv["symbol"])
            else:
                result = await _get_coingecko_price(inv["coin_id"])
            prices[inv["id"]] = {**result, "source": "live"}
        except Exception as e:
            print(f"[prices] {inv['id']}: {e}")
            prices[inv["id"]] = {"price": 0, "change": 0, "source": "error"}

    await asyncio.gather(*[fetch_one(inv) for inv in INVESTMENTS])
    return prices
