import secrets
from .db import db_cursor, run_in_thread


async def get_user(email: str) -> dict | None:
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT email, name, shortcut_token FROM users WHERE email = %s", (email,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row) if row else None


async def ensure_user(email: str, name: str) -> dict:
    """Crea el usuario si no existe; actualiza el nombre si ya existe."""
    def _q():
        token = secrets.token_urlsafe(32)
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO users (email, name, shortcut_token) VALUES (%s, %s, %s)
                   ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
                   RETURNING email, name, shortcut_token""",
                (email, name, token),
            )
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row)


async def get_email_by_shortcut_token(token: str) -> str | None:
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT email FROM users WHERE shortcut_token = %s", (token,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return row["email"] if row else None
