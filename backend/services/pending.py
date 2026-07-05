from fastapi import HTTPException
from .db import db_cursor, run_in_thread


async def create_pending(email: str, importe: float) -> dict:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "INSERT INTO pending_transactions (user_email, importe) VALUES (%s, %s) RETURNING id, fecha::text, importe",
                (email, importe),
            )
            return cur.fetchone()
    return dict(await run_in_thread(_q))


async def get_pending(email: str) -> list:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT id, importe, fecha::text FROM pending_transactions WHERE user_email = %s ORDER BY created_at ASC",
                (email,),
            )
            return cur.fetchall()
    rows = await run_in_thread(_q)
    return [dict(r) for r in rows]


async def categorize_pending(pending_id: int, email: str, tipo: str, concepto: str) -> dict:
    """Mueve una transacción pendiente a la tabla transactions con su fecha original."""
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT importe, fecha FROM pending_transactions WHERE id = %s AND user_email = %s",
                (pending_id, email),
            )
            row = cur.fetchone()
            if not row:
                return None
            cur.execute(
                "INSERT INTO transactions (user_email, fecha, tipo, concepto, importe) VALUES (%s, %s, %s, %s, %s) RETURNING id, fecha::text",
                (email, row["fecha"], tipo, concepto, row["importe"]),
            )
            tx = cur.fetchone()
            cur.execute("DELETE FROM pending_transactions WHERE id = %s", (pending_id,))
            return dict(tx)
    row = await run_in_thread(_q)
    if not row:
        raise HTTPException(status_code=404, detail="Transacción pendiente no encontrada")
    return row
