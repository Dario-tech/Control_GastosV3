"""Freemium: flag por usuario + lista de administradores siempre premium.

De momento no hay pasarela de pago — is_premium se activa a mano en la BD
(o automáticamente para los emails de admin). Sirve para dar de alta el
sistema de gating antes de conectar un cobro real.
"""
from .db import db_cursor, run_in_thread

# Cuentas del propio desarrollador: premium siempre, sin pasar por el paywall.
ADMIN_EMAILS = {"marioomc00@gmail.com", "mariomc00@hotmail.es"}


def ensure_premium_column():
    """Migración aditiva e idempotente. Además, re-marca a los admins como
    premium en cada arranque — cubre el caso de que ya existieran en la BD
    antes de esta columna, o entren por email/contraseña (sin pasar por
    ensure_user)."""
    with db_cursor() as cur:
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false")
        if ADMIN_EMAILS:
            cur.execute(
                "UPDATE users SET is_premium = true WHERE email = ANY(%s)",
                (list(ADMIN_EMAILS),),
            )


async def is_premium(email: str) -> bool:
    if email in ADMIN_EMAILS:
        return True

    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT is_premium FROM users WHERE email = %s", (email,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return bool(row and row["is_premium"])
