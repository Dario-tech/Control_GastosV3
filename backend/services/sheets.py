from datetime import date as date_type
from fastapi import HTTPException
from .db import db_cursor, run_in_thread
from .crypto import encrypt_str, decrypt_str, encrypt_float, decrypt_float


def ensure_comentario_column():
    """Migración aditiva e idempotente: comentario libre en cada transacción."""
    with db_cursor() as cur:
        cur.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS comentario TEXT")


def ensure_encrypted_columns():
    """Migración aditiva e idempotente: concepto e importe cifrados en reposo
    (ver services/crypto.py). tipo, fecha y comentario quedan en claro."""
    with db_cursor() as cur:
        cur.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS concepto_enc BYTEA")
        cur.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS importe_enc BYTEA")


# ── Helpers (lógica pura, sin I/O) ────────────────────────────────────────────

def _month_index(date_str: str) -> int | None:
    try:
        return int(str(date_str)[5:7]) - 1
    except Exception:
        return None


INCOME_CONCEPTS = {"nómina","nomina","salario","sueldo","bonus","extra","reembolso","ingreso"}
FIXED_CONCEPTS  = {"alquiler","hipoteca","piso","habitacion","habitación",
                   "luz","electricidad","gas","agua","wifi","internet",
                   "seguro","transporte","metro","abono","pension","pensión"}


def _classify_by_concept(concepto: str) -> str:
    key = concepto.lower().strip()
    if any(k in key for k in INCOME_CONCEPTS):
        return "income"
    if any(k in key for k in FIXED_CONCEPTS):
        return "fixedExpenses"
    return "variableExpenses"


def _normalize_tipo(raw, concepto: str = "") -> str:
    s = str(raw or "").strip()
    if "\n" in s:
        return _classify_by_concept(concepto)
    s = s.upper()
    if "INGRESO" in s:
        return "income"
    if "FIJO" in s:
        return "fixedExpenses"
    if "VARIABLE" in s:
        return "variableExpenses"
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
        fecha    = str(row.get("fecha", "") or "")
        tipo_raw = row.get("tipo", "")
        concepto = str(row.get("concepto", "") or "").strip() or "Sin categoría"
        importe  = float(row.get("importe", 0) or 0)
        row_id   = row.get("_rowIndex")
        comentario = row.get("comentario") or ""

        m_idx = _month_index(fecha)
        if m_idx is None or not (0 <= m_idx <= 11):
            continue

        try:
            yr = int(str(fecha)[:4])
            year_counts[yr] = year_counts.get(yr, 0) + 1
        except Exception:
            pass

        bucket = _normalize_tipo(tipo_raw, concepto)

        if concepto not in buckets:
            buckets[concepto] = {"bucket": bucket, "emoji": _emoji_for(concepto), "amounts": [0.0] * 12}
        buckets[concepto]["amounts"][m_idx] += abs(importe)

        transactions.append({
            "rowIndex":   row_id,
            "fecha":      fecha[:10],
            "concepto":   concepto,
            "importe":    abs(importe),
            "bucket":     bucket,
            "month":      m_idx,
            "comentario": comentario,
        })

    year = max(year_counts, key=year_counts.get) if year_counts else date_type.today().year

    result: dict = {
        "configured":       True,
        "year":             year,
        "activeMonths":     [False] * 12,
        "income":           [],
        "fixedExpenses":    [],
        "variableExpenses": [],
        "transactions":     transactions,
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


# ── I/O (PostgreSQL via psycopg2) ─────────────────────────────────────────────

async def get_finance_data(email: str) -> dict:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT id, fecha::text, tipo, concepto_enc, importe_enc, comentario FROM transactions WHERE user_email = %s ORDER BY fecha, id",
                (email,),
            )
            return cur.fetchall()

    rows = await run_in_thread(_q)

    if not rows:
        return {
            "configured":       False,
            "error":            "No hay transacciones registradas.",
            "year":             date_type.today().year,
            "activeMonths":     [False] * 12,
            "income":           [],
            "fixedExpenses":    [],
            "variableExpenses": [],
            "transactions":     [],
        }

    # Descifrado en Python — el backend es el único que tiene la clave.
    data_rows = [
        {"_rowIndex": r["id"], "fecha": r["fecha"], "tipo": r["tipo"],
         "concepto": decrypt_str(bytes(r["concepto_enc"])), "importe": decrypt_float(bytes(r["importe_enc"])),
         "comentario": r["comentario"]}
        for r in rows
    ]
    return _build_finance(data_rows)


async def delete_transaction(row_index: int, email: str = "") -> dict:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "DELETE FROM transactions WHERE id = %s AND user_email = %s",
                (row_index, email),
            )
            return cur.rowcount

    deleted = await run_in_thread(_q)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return {"status": "ok", "deleted": row_index}


async def post_transaction(
    importe: float, tipo: str, concepto: str, email: str = "", source: str = "shortcut",
    fecha: str | None = None, comentario: str | None = None,
) -> dict:
    concepto_enc = encrypt_str(concepto)
    importe_enc  = encrypt_float(importe)

    def _q():
        with db_cursor() as cur:
            if fecha:
                cur.execute(
                    """INSERT INTO transactions (user_email, tipo, concepto_enc, importe_enc, fecha, comentario)
                       VALUES (%s, %s, %s, %s, %s::date, %s) RETURNING id, fecha::text""",
                    (email, tipo, concepto_enc, importe_enc, fecha, comentario),
                )
            else:
                cur.execute(
                    """INSERT INTO transactions (user_email, tipo, concepto_enc, importe_enc, comentario)
                       VALUES (%s, %s, %s, %s, %s) RETURNING id, fecha::text""",
                    (email, tipo, concepto_enc, importe_enc, comentario),
                )
            return cur.fetchone()

    row = await run_in_thread(_q)
    return {"status": "ok", "id": row["id"], "fecha": row["fecha"]}


async def update_transaction_comment(row_index: int, email: str, comentario: str) -> dict:
    """Añadir o editar el comentario de una transacción ya guardada."""
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "UPDATE transactions SET comentario = %s WHERE id = %s AND user_email = %s",
                (comentario, row_index, email),
            )
            return cur.rowcount

    updated = await run_in_thread(_q)
    if updated == 0:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return {"status": "ok", "id": row_index, "comentario": comentario}


async def get_raw_transactions(email: str = "") -> dict:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT id, fecha::text, tipo, concepto_enc, importe_enc, comentario FROM transactions WHERE user_email = %s ORDER BY fecha DESC, id DESC LIMIT 100",
                (email,),
            )
            return cur.fetchall()

    rows = await run_in_thread(_q)
    return {"data": [
        {"id": r["id"], "fecha": r["fecha"], "tipo": r["tipo"], "comentario": r["comentario"],
         "concepto": decrypt_str(bytes(r["concepto_enc"])), "importe": decrypt_float(bytes(r["importe_enc"]))}
        for r in rows
    ]}
