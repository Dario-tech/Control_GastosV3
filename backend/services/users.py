from .db import db_cursor, run_in_thread


async def get_user(email: str) -> dict | None:
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT email, name FROM users WHERE email = %s", (email,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row) if row else None


async def ensure_user(email: str, name: str) -> dict:
    """Crea el usuario si no existe; actualiza el nombre si ya existe."""
    def _q():
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO users (email, name) VALUES (%s, %s)
                   ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
                   RETURNING email, name""",
                (email, name),
            )
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row)
