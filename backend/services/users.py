from fastapi import HTTPException
from .db import get_pool


async def get_user(email: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT email, name FROM users WHERE email = $1", email
        )
    return dict(row) if row else None


async def ensure_user(email: str, name: str) -> dict:
    """Crea el usuario si no existe; actualiza el nombre si ya existe."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO users (email, name) VALUES ($1, $2)
               ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
               RETURNING email, name""",
            email, name,
        )
    return dict(row)
