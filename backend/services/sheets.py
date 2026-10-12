from datetime import date as date_type
from fastapi import HTTPException
from .db import db_cursor, run_in_thread
from .crypto import encrypt_str, encrypt_float, decrypt_transaction


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


def ensure_search_index():
    """Índice para paginar por (usuario, fecha, id) sin escanear toda la tabla
    en cada página de búsqueda — ver search_transactions más abajo."""
    with db_cursor() as cur:
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_transactions_search "
            "ON transactions(user_email, fecha DESC, id DESC)"
        )


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


def _row_year(fecha: str) -> int | None:
    try:
        return int(str(fecha)[:4])
    except Exception:
        return None


def _pick_year(rows: list[dict], year: int | None) -> int:
    """Año al que corresponden los agregados: el pedido, o si no el actual
    (si hay datos suyos) o, en su defecto, el más reciente con datos."""
    if year is not None:
        return year
    years = {y for y in (_row_year(r.get("fecha", "")) for r in rows) if y is not None}
    today = date_type.today().year
    if not years or today in years:
        return today
    return max(years)


def _build_finance(rows: list[dict], year: int | None = None) -> dict:
    """Agrega `rows` (que pueden abarcar varios años).

    Los agregados por concepto (income/fixedExpenses/variableExpenses/activeMonths)
    corresponden SOLO al año `year` (por defecto el actual, o el último con datos);
    antes se sumaban los meses de todos los años en los mismos 12 huecos.
    `transactions` contiene todas las filas recibidas, de cualquier año, para que el
    cliente pueda navegar entre años.
    """
    buckets: dict[str, dict] = {}
    transactions: list[dict] = []
    year = _pick_year(rows, year)

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

        bucket = _normalize_tipo(tipo_raw, concepto)

        if _row_year(fecha) == year:
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

async def get_finance_data(email: str, year: int | None = None) -> dict:
    """Datos financieros del usuario.

    Sin `year`: todas las transacciones (como siempre), con los agregados del año
    actual (o el último con datos). Con `year`: solo se leen y descifran las filas
    de ese año (filtro por rango de fecha en SQL). En ambos casos se devuelve
    `availableYears` con los años que tienen transacciones.
    """
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT DISTINCT EXTRACT(YEAR FROM fecha)::int AS y FROM transactions WHERE user_email = %s ORDER BY y",
                (email,),
            )
            years = [r["y"] for r in cur.fetchall()]
            if year is None:
                cur.execute(
                    "SELECT id, fecha::text, tipo, concepto_enc, importe_enc, comentario FROM transactions WHERE user_email = %s ORDER BY fecha, id",
                    (email,),
                )
            else:
                cur.execute(
                    "SELECT id, fecha::text, tipo, concepto_enc, importe_enc, comentario FROM transactions "
                    "WHERE user_email = %s AND fecha >= make_date(%s, 1, 1) AND fecha < make_date(%s, 1, 1) ORDER BY fecha, id",
                    (email, year, year + 1),
                )
            return years, cur.fetchall()

    available_years, rows = await run_in_thread(_q)

    if not available_years:
        return {
            "configured":       False,
            "error":            "No hay transacciones registradas.",
            "year":             year or date_type.today().year,
            "availableYears":   [],
            "activeMonths":     [False] * 12,
            "income":           [],
            "fixedExpenses":    [],
            "variableExpenses": [],
            "transactions":     [],
        }

    # Descifrado en Python — el backend es el único que tiene la clave.
    # Las filas que no se puedan descifrar se omiten (ver decrypt_transaction).
    result = _decrypt_and_build(rows, year)
    result["availableYears"] = available_years
    return result


def _decrypt_and_build(rows, year: int | None = None) -> dict:
    data_rows = []
    for r in rows:
        dec = decrypt_transaction(r["concepto_enc"], r["importe_enc"], r["id"])
        if dec is None:
            continue  # fila indescifrable: se omite (ya registrada en el log)
        data_rows.append({"_rowIndex": r["id"], "fecha": r["fecha"], "tipo": r["tipo"],
                          "concepto": dec[0], "importe": dec[1], "comentario": r["comentario"]})
    return _build_finance(data_rows, year)


# Filtro SQL aproximado por tipo — barato porque `tipo` no está cifrado, así
# reducimos cuántas filas hace falta descifrar antes de mirar si el concepto
# encaja con la búsqueda. "all" no filtra nada.
BUCKET_SQL_PATTERN = {
    "income":           "%INGRESO%",
    "fixedExpenses":    "%FIJO%",
    "variableExpenses": "%VARIABLE%",
}

SEARCH_BATCH_SIZE = 200   # filas que se piden a la vez a la base de datos
SEARCH_MAX_SCAN   = 1000  # tope de filas a descifrar por petición (~5 tandas)


def _parse_cursor(cursor: str | None) -> tuple[str, int] | None:
    if not cursor:
        return None
    try:
        fecha, id_str = cursor.rsplit("_", 1)
        return fecha, int(id_str)
    except (ValueError, TypeError):
        return None


async def search_transactions(
    email: str, q: str = "", tipo: str = "all", cursor: str | None = None, limit: int = 30,
) -> dict:
    """Búsqueda paginada de transacciones.

    concepto/importe están cifrados con nonce aleatorio, así que no se puede
    filtrar por texto en SQL — hay que descifrar fila a fila. Para que esto
    escale con el historial en vez de descifrar la tabla entera en cada
    búsqueda, se pagina con un cursor (fecha, id) yendo hacia atrás en el
    tiempo en tandas de SEARCH_BATCH_SIZE, descifrando y filtrando por texto
    sobre la marcha, hasta reunir `limit` resultados o agotar el tope de
    escaneo por petición (SEARCH_MAX_SCAN) — lo que llegue antes. Si hace
    falta seguir buscando más atrás, el cliente pide la siguiente página con
    el `next_cursor` devuelto ("cargar más").
    """
    limit = max(1, min(limit, 100))
    q_norm = q.strip().lower()
    tipo_pattern = BUCKET_SQL_PATTERN.get(tipo)
    after = _parse_cursor(cursor)

    def _fetch_batch(after_fecha: str | None, after_id: int | None):
        with db_cursor() as cur:
            clauses = ["user_email = %s"]
            params: list = [email]
            if tipo_pattern:
                clauses.append("tipo ILIKE %s")
                params.append(tipo_pattern)
            if after_fecha is not None:
                clauses.append("(fecha, id) < (%s::date, %s)")
                params.extend([after_fecha, after_id])
            params.append(SEARCH_BATCH_SIZE)
            cur.execute(
                f"""SELECT id, fecha::text, tipo, concepto_enc, importe_enc, comentario
                    FROM transactions WHERE {' AND '.join(clauses)}
                    ORDER BY fecha DESC, id DESC LIMIT %s""",
                params,
            )
            return cur.fetchall()

    results: list[dict] = []
    scanned = 0
    last_fecha = after[0] if after else None
    last_id    = after[1] if after else None
    exhausted  = False

    while len(results) < limit and scanned < SEARCH_MAX_SCAN:
        batch = await run_in_thread(lambda: _fetch_batch(last_fecha, last_id))
        if not batch:
            exhausted = True
            break
        batch_fully_consumed = True
        for row in batch:
            scanned += 1
            # El cursor avanza fila a fila según lo escaneado, no según el
            # final de la tanda — si cortamos a mitad de tanda porque ya
            # tenemos `limit` resultados, el resto de esa tanda no se pierde:
            # queda pendiente para la siguiente página.
            last_fecha, last_id = row["fecha"], row["id"]
            dec = decrypt_transaction(row["concepto_enc"], row["importe_enc"], row["id"])
            if dec is None:
                continue  # fila indescifrable: se omite (ya registrada en el log)
            concepto, importe = dec[0], abs(dec[1])
            if q_norm and q_norm not in concepto.lower():
                continue
            results.append({
                "rowIndex":   row["id"],
                "fecha":      row["fecha"][:10],
                "concepto":   concepto,
                "importe":    importe,
                "bucket":     _normalize_tipo(row["tipo"], concepto),
                "comentario": row["comentario"] or "",
            })
            if len(results) >= limit:
                batch_fully_consumed = False
                break
        if batch_fully_consumed and len(batch) < SEARCH_BATCH_SIZE:
            exhausted = True

    next_cursor = None
    if not exhausted and (len(results) >= limit or scanned >= SEARCH_MAX_SCAN):
        next_cursor = f"{last_fecha}_{last_id}"

    return {"results": results, "next_cursor": next_cursor}


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

