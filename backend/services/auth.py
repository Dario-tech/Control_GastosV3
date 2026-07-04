import os
from datetime import datetime, timedelta
from fastapi import HTTPException, Header
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from jose import jwt, JWTError

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
JWT_SECRET       = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM    = "HS256"
JWT_EXPIRE_DAYS  = 30


def verify_google_token(token: str) -> dict:
    try:
        info = id_token.verify_oauth2_token(
            token, google_requests.Request(), GOOGLE_CLIENT_ID
        )
        return {
            "email":   info["email"],
            "name":    info.get("name", ""),
            "picture": info.get("picture", ""),
        }
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
        return payload["sub"]  # email del usuario
    except JWTError:
        raise HTTPException(status_code=401, detail="Token de sesión inválido o expirado")
