import os
import httpx
from fastapi import HTTPException

USERS_SHEET_URL = os.getenv("USERS_SHEET_URL", "")


async def get_user(email: str) -> dict | None:
    """Busca un usuario en el Sheet de usuarios. Devuelve None si no existe."""
    if not USERS_SHEET_URL:
        raise HTTPException(status_code=500, detail="USERS_SHEET_URL no configurado")
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        res = await client.get(USERS_SHEET_URL, params={"email": email})
        res.raise_for_status()
    data = res.json()
    return data if data.get("found") else None


async def register_user(email: str, name: str, sheet_url: str) -> dict:
    """Añade o actualiza un usuario en el Sheet de usuarios."""
    if not USERS_SHEET_URL:
        raise HTTPException(status_code=500, detail="USERS_SHEET_URL no configurado")
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        res = await client.post(
            USERS_SHEET_URL,
            json={"email": email, "name": name, "sheet_url": sheet_url},
        )
        res.raise_for_status()
    return res.json()


async def get_user_sheet_url(email: str) -> str:
    user = await get_user(email)
    if not user or not user.get("sheet_url"):
        raise HTTPException(status_code=403, detail="Usuario sin Sheet configurado")
    return user["sheet_url"]
