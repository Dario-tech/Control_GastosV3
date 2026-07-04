import os
import httpx
from datetime import datetime, timedelta
from fastapi import HTTPException, Header
from jose import jwt as jose_jwt, JWTError

GOOGLE_CLIENT_ID  = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_TOKENINFO  = "https://oauth2.googleapis.com/tokeninfo"
JWT_SECRET        = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM     = "HS256"
JWT_EXPIRE_DAYS   = 30


async def verify_google_token(token: str) -> dict:
    """Verifica un Google ID token usando el endpoint tokeninfo de Google.
    Google valida la firma internamente — no necesitamos descargar certificados."""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            res = await client.get(GOOGLE_TOKENINFO, params={"id_token": token})

        if res.status_code != 200:
            detail = res.json().get("error_description", "Token inválido")
            raise HTTPException(status_code=401, detail=detail)

        info = res.json()

        if info.get("aud") != GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=401, detail="Token no corresponde a esta aplicación")

        return {
            "email":   info["email"],
            "name":    info.get("name", ""),
            "picture": info.get("picture", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Error verificando token: {e}")


def create_jwt(email: str) -> str:
    payload = {
        "sub": email,
        "exp": datetime.utcnow() + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jose_jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(authorization: str = Header(default="")) -> str:
    """Dependencia FastAPI: extrae y verifica el JWT del header Authorization."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header requerido")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jose_jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Token de sesión inválido o expirado")
