import secrets
from .db import db_cursor, run_in_thread
from .premium import ADMIN_EMAILS


def ensure_password_column():
    """Migración ADITIVA e idempotente: añade la columna password_hash si no existe.
    No borra ni modifica datos existentes. Los usuarios de Google la tendrán a NULL.
    Se ejecuta al arrancar el backend."""
    with db_cursor() as cur:
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT")


async def get_user(email: str) -> dict | None:
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT email, name, shortcut_token FROM users WHERE email = %s", (email,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row) if row else None


async def get_password_hash(email: str) -> str | None:
    """Devuelve el hash de contraseña, o None si el usuario no existe o es solo-Google."""
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT password_hash FROM users WHERE email = %s", (email,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return (row["password_hash"] if row else None)


async def create_user_with_password(email: str, name: str, password_hash: str) -> dict | None:
    """Crea un usuario con contraseña. Devuelve None si el email ya existe."""
    is_admin = email in ADMIN_EMAILS

    def _q():
        token = secrets.token_urlsafe(32)
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO users (email, name, shortcut_token, password_hash, is_premium)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (email) DO NOTHING
                   RETURNING email, name, shortcut_token""",
                (email, name, token, password_hash, is_admin),
            )
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row) if row else None


async def ensure_user(email: str, name: str) -> dict:
    """Crea el usuario si no existe; actualiza el nombre si ya existe."""
    is_admin = email in ADMIN_EMAILS

    def _q():
        token = secrets.token_urlsafe(32)
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO users (email, name, shortcut_token, is_premium) VALUES (%s, %s, %s, %s)
                   ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name,
                       is_premium = users.is_premium OR EXCLUDED.is_premium
                   RETURNING email, name, shortcut_token""",
                (email, name, token, is_admin),
            )
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row)


async def get_all_users() -> list[dict]:
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT email, name FROM users")
            return cur.fetchall()
    rows = await run_in_thread(_q)
    return [dict(r) for r in rows]


async def get_email_by_shortcut_token(token: str) -> str | None:
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT email FROM users WHERE shortcut_token = %s", (token,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return row["email"] if row else None
