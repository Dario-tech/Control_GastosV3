"""Gastos fijos anuales (IBI, seguro del coche, etc.): se configuran una vez
con su importe y fecha de vencimiento, y la app avisa cuando se acerca y
sugiere cuánto apartar al mes si el usuario quiere repartir el golpe.
"""
from datetime import date
from fastapi import HTTPException
from .db import db_cursor, run_in_thread


def ensure_annual_expenses_table():
    """Migración aditiva e idempotente."""
    with db_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS annual_fixed_expenses (
                id            SERIAL PRIMARY KEY,
                user_email    TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                nombre        TEXT NOT NULL,
                importe       NUMERIC(12,2) NOT NULL,
                mes           INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
                dia           INTEGER NOT NULL DEFAULT 1 CHECK (dia BETWEEN 1 AND 31),
                dividir_meses INTEGER,
                avisar        BOOLEAN NOT NULL DEFAULT true,
                dias_aviso    INTEGER NOT NULL DEFAULT 15,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_annual_exp_user ON annual_fixed_expenses(user_email)")
        # Meses concretos (1-12) en los que se reparte el gasto — permite elegir
        # exactamente qué meses, no solo cuántos. Sustituye a dividir_meses (que
        # se mantiene solo por compatibilidad y se deriva de esta lista).
        cur.execute("ALTER TABLE annual_fixed_expenses ADD COLUMN IF NOT EXISTS meses_reparto INTEGER[]")


def _next_due_date(mes: int, dia: int, today: date) -> date:
    """Próxima fecha de vencimiento: este año si aún no ha pasado, si no el que viene."""
    dia = min(dia, 28) if mes == 2 else dia  # evita 30/31 de febrero
    try:
        candidate = date(today.year, mes, dia)
    except ValueError:
        candidate = date(today.year, mes, 28)
    if candidate < today:
        try:
            candidate = date(today.year + 1, mes, dia)
        except ValueError:
            candidate = date(today.year + 1, mes, 28)
    return candidate


def _enrich(row: dict, today: date | None = None) -> dict:
    today = today or date.today()
    proxima = _next_due_date(row["mes"], row["dia"], today)
    dias_restantes = (proxima - today).days
    meses_reparto = sorted(row.get("meses_reparto") or [])
    reparto_mensual = round(float(row["importe"]) / len(meses_reparto), 2) if meses_reparto else None
    return {
        **row,
        "importe": float(row["importe"]),
        "proximo_vencimiento": proxima.isoformat(),
        "dias_restantes": dias_restantes,
        "aviso_activo": bool(row["avisar"] and dias_restantes <= row["dias_aviso"]),
        "meses_reparto": meses_reparto,
        "reparto_mensual": reparto_mensual,
    }


async def list_for_user(email: str) -> list[dict]:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                """SELECT id, nombre, importe, mes, dia, meses_reparto, avisar, dias_aviso
                   FROM annual_fixed_expenses WHERE user_email = %s ORDER BY mes, dia""",
                (email,),
            )
            return [dict(r) for r in cur.fetchall()]
    rows = await run_in_thread(_q)
    enriched = [_enrich(r) for r in rows]
    enriched.sort(key=lambda r: r["dias_restantes"])
    return enriched


async def create(email: str, nombre: str, importe: float, mes: int, dia: int,
                  meses_reparto: list[int] | None, avisar: bool, dias_aviso: int) -> dict:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO annual_fixed_expenses
                   (user_email, nombre, importe, mes, dia, meses_reparto, avisar, dias_aviso)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (email, nombre, importe, mes, dia, meses_reparto or None, avisar, dias_aviso),
            )
            return cur.fetchone()["id"]
    new_id = await run_in_thread(_q)
    for item in await list_for_user(email):
        if item["id"] == new_id:
            return item
    raise HTTPException(status_code=500, detail="No se pudo crear el gasto fijo")


async def _require_owner(expense_id: int, email: str):
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT 1 FROM annual_fixed_expenses WHERE id = %s AND user_email = %s", (expense_id, email))
            return cur.fetchone()
    if not await run_in_thread(_q):
        raise HTTPException(status_code=404, detail="Gasto fijo no encontrado")


async def update(email: str, expense_id: int, nombre: str, importe: float, mes: int, dia: int,
                  meses_reparto: list[int] | None, avisar: bool, dias_aviso: int) -> dict:
    await _require_owner(expense_id, email)

    def _q():
        with db_cursor() as cur:
            cur.execute(
                """UPDATE annual_fixed_expenses
                   SET nombre=%s, importe=%s, mes=%s, dia=%s, meses_reparto=%s, avisar=%s, dias_aviso=%s
                   WHERE id=%s AND user_email=%s""",
                (nombre, importe, mes, dia, meses_reparto or None, avisar, dias_aviso, expense_id, email),
            )
    await run_in_thread(_q)
    for item in await list_for_user(email):
        if item["id"] == expense_id:
            return item
    raise HTTPException(status_code=404, detail="Gasto fijo no encontrado")


async def delete(email: str, expense_id: int) -> None:
    await _require_owner(expense_id, email)

    def _q():
        with db_cursor() as cur:
            cur.execute("DELETE FROM annual_fixed_expenses WHERE id = %s AND user_email = %s", (expense_id, email))
    await run_in_thread(_q)
