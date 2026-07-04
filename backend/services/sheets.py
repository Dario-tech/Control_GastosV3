import httpx
import os
import asyncio
from dotenv import load_dotenv

load_dotenv()

APPS_SCRIPT_URL = os.getenv(
    "APPS_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbwIYTgQffssqwtcJNKPgMuXrrj1nZHMTNVJJcO-iD4Ydgq2ODHv7efxQ3_6Wsx3Q9po/exec"
)


async def _fetch_raw(sheet_url: str = "") -> dict:
    url = sheet_url or APPS_SCRIPT_URL
    last_err = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                res = await client.get(url)
                res.raise_for_status()
            return res.json()
        except Exception as e:
            last_err = e
            if attempt < 2:
                await asyncio.sleep(1)
    raise last_err


def _parse_number(val) -> float:
    if val is None or val == "":
        return 0.0
    s = str(val).strip().replace("€", "").replace(" ", "").replace("\xa0", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _month_index(date_str: str) -> int | None:
    try:
        return int(str(date_str)[5:7]) - 1
    except Exception:
        return None


INCOME_CONCEPTS  = {"nómina","nomina","salario","sueldo","bonus","extra","reembolso","ingreso"}
FIXED_CONCEPTS   = {"alquiler","hipoteca","piso","habitacion","habitación",
                    "luz","electricidad","gas","agua","wifi","internet",
                    "seguro","transporte","metro","abono","pension","pensión"}

def _classify_by_concept(concepto: str) -> str:
    """Fallback cuando el tipo no es un valor limpio."""
    key = concepto.lower().strip()
    if any(k in key for k in INCOME_CONCEPTS):
        return "income"
    if any(k in key for k in FIXED_CONCEPTS):
        return "fixedExpenses"
    return "variableExpenses"

def _normalize_tipo(raw, concepto: str = "") -> str:
    s = str(raw or "").strip()

    # Si hay saltos de línea el desplegable envió todas las opciones juntas
    # (dato de test o error del móvil) → clasificar por el concepto
    if "\n" in s:
        return _classify_by_concept(concepto)

    s = s.upper()
    if "INGRESO" in s:
        return "income"
    if "FIJO" in s:
        return "fixedExpenses"
    if "VARIABLE" in s:
        return "variableExpenses"

    # tipo vacío o desconocido → también por concepto
    return _classify_by_concept(concepto)


EMOJI_MAP = {
    "nómina": "💼", "nomina": "💼", "salario": "💼",
    "bonus": "🎁",  "extra": "🎁",
    "alquiler": "🏠", "hipoteca": "🏠", "piso": "🏠",
    "luz": "⚡", "electricidad": "⚡",
    "gas": "🔥", "agua": "🚿",
    "wifi": "📡", "internet": "📡",
    "seguro": "🏥",
    "transporte": "🚇", "metro": "🚇", "bus": "🚌",
    "comida": "🍽️", "supermercado": "🛒", "mercadona": "🛒",
    "ocio": "🎉", "salidas": "🎉",
    "viaje": "✈️", "vuelo": "✈️",
    "ropa": "👗", "gimnasio": "💪",
    "suscripcion": "📺", "netflix": "📺", "spotify": "🎵",
    "cripto": "₿", "bitcoin": "₿",
    "inversión": "📈", "inversion": "📈",
}

def _emoji_for(concepto: str) -> str:
    key = concepto.lower().strip()
    for k, e in EMOJI_MAP.items():
        if k in key:
            return e
    return "💶"


def _build_finance(rows: list[dict]) -> dict:
    buckets: dict[str, dict] = {}
    transactions: list[dict] = []
    year_counts: dict[int, int] = {}

    for row in rows:
        fecha     = str(row.get("fecha",    "") or "")
        tipo_raw  = row.get("tipo", "")
        concepto  = str(row.get("concepto", "") or "").strip() or "Sin categoría"
        importe   = _parse_number(row.get("importe", 0))
        row_index = row.get("_rowIndex")

        m_idx = _month_index(fecha)
        if m_idx is None or m_idx < 0 or m_idx > 11:
            continue

        try:
            yr = int(str(fecha)[:4])
            year_counts[yr] = year_counts.get(yr, 0) + 1
        except Exception:
            pass

        bucket = _normalize_tipo(tipo_raw, concepto)

        if concepto not in buckets:
            buckets[concepto] = {
                "bucket": bucket,
                "emoji":  _emoji_for(concepto),
                "amounts": [0.0] * 12,
            }
        buckets[concepto]["amounts"][m_idx] += abs(importe)

        # Guardar transacción individual con su rowIndex para poder borrarla
        transactions.append({
            "rowIndex": row_index,
            "fecha":    fecha[:10],          # solo YYYY-MM-DD
            "concepto": concepto,
            "importe":  abs(importe),
            "bucket":   bucket,
            "month":    m_idx,
        })

    year = max(year_counts, key=year_counts.get) if year_counts else 2025

    result: dict = {
        "configured":      True,
        "year":            year,
        "activeMonths":    [False] * 12,
        "income":          [],
        "fixedExpenses":   [],
        "variableExpenses":[],
        "transactions":    transactions,
    }

    for concepto, info in buckets.items():
        entry = {"concept": concepto, "emoji": info["emoji"], "amounts": info["amounts"]}
        for i, v in enumerate(info["amounts"]):
            if v != 0:
                result["activeMonths"][i] = True
        result[info["bucket"]].append(entry)

    for key in ("income", "fixedExpenses", "variableExpenses"):
        result[key].sort(key=lambda x: sum(x["amounts"]), reverse=True)

    return result


async def get_finance_data(sheet_url: str = "") -> dict:
    raw  = await _fetch_raw(sheet_url)
    rows = raw.get("data", [])

    if not rows:
        return {
            "configured": False,
            "error": "La hoja 'Transacciones' está vacía.",
            "year": 2025,
            "activeMonths": [False] * 12,
            "income": [], "fixedExpenses": [], "variableExpenses": [],
            "transactions": [],
        }

    return _build_finance(rows)


async def delete_transaction(row_index: int, sheet_url: str = "") -> dict:
    url = sheet_url or APPS_SCRIPT_URL
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        res = await client.post(url, json={"method": "delete", "rowIndex": row_index})
        res.raise_for_status()
    return res.json()


async def post_transaction(importe: float, tipo: str, concepto: str, sheet_url: str = "", source: str = "shortcut") -> dict:
    url = sheet_url or APPS_SCRIPT_URL
    body = {"importe": importe, "tipo": tipo, "concepto": concepto, "source": source}
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        res = await client.post(url, json=body)
        res.raise_for_status()
    return res.json()


async def get_raw_transactions(sheet_url: str = "") -> dict:
    return await _fetch_raw(sheet_url)
