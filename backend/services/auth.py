import os
import httpx
from datetime import datetime, timedelta
from fastapi import HTTPException, Header
from jose import jwt, JWTError

GOOGLE_CLIENT_ID  = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CERTS_URL  = "https://www.googleapis.com/oauth2/v1/certs"
JWT_SECRET        = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM     = "HS256"
JWT_EXPIRE_DAYS   = 30


async def verify_google_token(token: str) -> dict:
    """Verifica un Google ID token usando httpx + python-jose (sin google-auth)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(GOOGLE_CERTS_URL)
            certs = res.json()  # {"kid": "-----BEGIN CERTIFICATE-----..."}

        header  = jwt.get_unverified_header(token)
        cert    = certs.get(header.get("kid"))
        if not cert:
            raise HTTPException(status_code=401, detail="Certificado de Google no encontrado")

        payload = jwt.decode(
            token,
            cert,
            algorithms=["RS256"],
            audience=GOOGLE_CLIENT_ID,
        )
        return {
            "email":   payload["email"],
            "name":    payload.get("name", ""),
            "picture": payload.get("picture", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token Google inválido: {e}")


def create_jwt(email: str) -> str:
    payload = {
        "sub": email,
        "exp": datetime.utcnow() + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(authorization: str = Header(default="")) -> str:
    """Dependencia FastAPI: extrae y verifica el JWT del header Authorization."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header requerido")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Token de sesión inválido o expirado")
