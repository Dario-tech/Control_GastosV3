import os
import httpx
import logging
from datetime import datetime, timedelta
from fastapi import HTTPException, Header
from jose import jwt as jose_jwt, JWTError
import jwt as pyjwt
from cryptography import x509
from cryptography.hazmat.backends import default_backend

logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs"
JWT_SECRET       = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM    = "HS256"
JWT_EXPIRE_DAYS  = 30


async def verify_google_token(token: str) -> dict:
    """Verifica un Google ID token usando PyJWT + cryptography."""
    try:
        logger.warning(f"[AUTH] token[:30]={token[:30]}")
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            res = await client.get(GOOGLE_CERTS_URL)
            res.raise_for_status()
            certs = res.json()
        logger.warning(f"[AUTH] certs keys={list(certs.keys())[:3]}")

        header   = pyjwt.get_unverified_header(token)
        logger.warning(f"[AUTH] header={header}")
        cert_str = certs.get(header.get("kid"))
        if not cert_str:
            raise HTTPException(status_code=401, detail="Certificado de Google no encontrado")

        cert_obj   = x509.load_pem_x509_certificate(cert_str.encode(), default_backend())
        public_key = cert_obj.public_key()
        logger.warning(f"[AUTH] public_key loaded OK")

        payload = pyjwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=GOOGLE_CLIENT_ID,
        )
        logger.warning(f"[AUTH] decoded OK email={payload.get('email')}")
        return {
            "email":   payload["email"],
            "name":    payload.get("name", ""),
            "picture": payload.get("picture", ""),
        }
    except pyjwt.exceptions.PyJWTError as e:
        logger.error(f"[AUTH] PyJWTError: {e}")
        raise HTTPException(status_code=401, detail=f"Token Google inválido: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[AUTH] Exception {type(e).__name__}: {e}")
        raise HTTPException(status_code=401, detail=f"Error verificando token: {type(e).__name__}: {e}")


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
