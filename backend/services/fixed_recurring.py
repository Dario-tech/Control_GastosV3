"""Gastos fijos que se repiten cada mes hasta una fecha (el piso hasta dic-2027…).

El usuario los da de alta UNA vez (concepto, importe, día, desde qué mes y hasta cuál,
o sin fecha de fin); la app los proyecta en cada mes como gasto fijo previsto, sin crear
movimientos reales (si ese mes apunta el real, sustituye al previsto). Los que cambian de
importe cada mes (la luz) NO se dan de alta: los apunta el usuario cuando le llegan.

Concepto e importe van cifrados (AES-GCM, crypto.py) como en `transactions`; el mes de
inicio y de fin (primer día del mes) quedan en claro para poder filtrar.
Cada consulta filtra por `user_email`. Nunca se registran conceptos ni importes.
"""
import re
from datetime import date

from fastapi import HTTPException

from .db import db_cursor, run_in_thread
from .crypto import encrypt_str, decrypt_str, encrypt_float, decrypt_float
from .importes import validar_importe

MAX_RULES = 50
CONCEPTO_MAX = 60
_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")


def ensure_fixed_recurring_table():
    """Migración aditiva e idempotente."""
    with db_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS fixed_recurring (
                id           SERIAL PRIMARY KEY,
                user_email   TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                concepto_enc BYTEA NOT NULL,
                importe_enc  BYTEA NOT NULL,
                dia          INTEGER NOT NULL DEFAULT 1 CHECK (dia BETWEEN 1 AND 31),
                desde        DATE NOT NULL,
                hasta        DATE,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_fixed_recurring_user ON fixed_recurring(user_email)")
        cur.execute("ALTER TABLE fixed_recurring ENABLE ROW LEVEL SECURITY")


def parse_month(raw, nombre: str = "mes") -> date:
    """'AAAA-MM' -> primer día de ese mes. 422 si no es un mes razonable (2000 .. hoy+15 años)."""
    m = _MONTH_RE.match(raw.strip()) if isinstance(raw, str) else None
    if not m or not (1 <= int(m.group(2)) <= 12):
        raise HTTPException(status_code=422, detail=f"El {nombre} debe tener el formato AAAA-MM")
    d = date(int(m.group(1)), int(m.group(2)), 1)
    if d.year < 2000 or d.year > date.today().year + 15:
        raise HTTPException(status_code=422, detail=f"El {nombre} está fuera de rango")
    return d


def validate(concepto, importe, dia, desde, hasta) -> dict:
    if not isinstance(concepto, str) or not concepto.strip():
        raise HTTPException(status_code=422, detail="El concepto no puede estar vacío")
    concepto = " ".join(concepto.split())
    if len(concepto) > CONCEPTO_MAX:
        raise HTTPException(status_code=422, detail=f"El concepto no puede superar {CONCEPTO_MAX} caracteres")
    if any(0xD800 <= ord(c) <= 0xDFFF or ord(c) < 32 for c in concepto):
        raise HTTPException(status_code=422, detail="Texto inválido")
    try:
        importe = validar_importe(importe)
    except ValueError:
        raise HTTPException(status_code=422, detail="El importe debe ser mayor que 0 y no superar 1.000.000")
    if isinstance(dia, bool) or not isinstance(dia, int) or not (1 <= dia <= 31):
        raise HTTPException(status_code=422, detail="El día debe estar entre 1 y 31")
    d = parse_month(desde, "mes de inicio")
    h = parse_month(hasta, "mes de fin") if hasta not in (None, "") else None
    if h is not None and h < d:
        raise HTTPException(status_code=422, detail="El mes de fin no puede ser anterior al de inicio")
    return {"concepto": concepto, "importe": importe, "dia": dia, "desde": d, "hasta": h}


def _row(r) -> dict | None:
    try:
        return {
            "id": r["id"], "concepto": decrypt_str(bytes(r["concepto_enc"])),
            "importe": decrypt_float(bytes(r["importe_enc"])), "dia": r["dia"],
            "desde": r["desde"].strftime("%Y-%m"),
            "hasta": r["hasta"].strftime("%Y-%m") if r["hasta"] else None,
        }
    except Exception:
        return None  # fila ilegible (otra clave…): se omite; nunca se registra el contenido


async def list_for_user(email: str) -> list[dict]:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                """SELECT id, concepto_enc, importe_enc, dia, desde, hasta FROM fixed_recurring
                   WHERE user_email = %s ORDER BY desde, id""", (email,))
            return cur.fetchall()
    return [x for x in map(_row, await run_in_thread(_q)) if x]


async def _get(email: str, rule_id: int) -> dict:
    for r in await list_for_user(email):
        if r["id"] == rule_id:
            return r
    raise HTTPException(status_code=404, detail="Gasto fijo no encontrado")


async def create(email: str, concepto, importe, dia, desde, hasta) -> dict:
    v = validate(concepto, importe, dia, desde, hasta)

    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM fixed_recurring WHERE user_email = %s", (email,))
            if cur.fetchone()["n"] >= MAX_RULES:
                raise HTTPException(status_code=422, detail=f"Máximo {MAX_RULES} gastos fijos que se repiten")
            cur.execute(
                """INSERT INTO fixed_recurring (user_email, concepto_enc, importe_enc, dia, desde, hasta)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                (email, encrypt_str(v["concepto"]), encrypt_float(v["importe"]), v["dia"], v["desde"], v["hasta"]))
            return cur.fetchone()["id"]
    return await _get(email, await run_in_thread(_q))


async def update(email: str, rule_id: int, concepto, importe, dia, desde, hasta) -> dict:
    v = validate(concepto, importe, dia, desde, hasta)

    def _q():
        with db_cursor() as cur:
            cur.execute(
                """UPDATE fixed_recurring SET concepto_enc=%s, importe_enc=%s, dia=%s, desde=%s, hasta=%s
                   WHERE id=%s AND user_email=%s""",
                (encrypt_str(v["concepto"]), encrypt_float(v["importe"]), v["dia"], v["desde"], v["hasta"], rule_id, email))
            return cur.rowcount
    if not await run_in_thread(_q):
        raise HTTPException(status_code=404, detail="Gasto fijo no encontrado")
    return await _get(email, rule_id)


async def delete(email: str, rule_id: int) -> None:
    def _q():
        with db_cursor() as cur:
            cur.execute("DELETE FROM fixed_recurring WHERE id = %s AND user_email = %s", (rule_id, email))
            return cur.rowcount
    if not await run_in_thread(_q):
        raise HTTPException(status_code=404, detail="Gasto fijo no encontrado")
