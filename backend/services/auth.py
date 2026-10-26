import os
import logging
import secrets
import threading
import time
import bcrypt
import httpx
import jwt as pyjwt
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, Header

GOOGLE_CLIENT_ID  = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_TOKENINFO  = "https://oauth2.googleapis.com/tokeninfo"
_INSECURE_JWT_DEFAULT = "dev-secret-change-in-production"
JWT_SECRET        = os.getenv("JWT_SECRET", "")
if not JWT_SECRET or JWT_SECRET == _INSECURE_JWT_DEFAULT:
    raise RuntimeError(
        "JWT_SECRET no está definida (o es el valor inseguro por defecto). "
        "Defínela en el entorno / backend/.env antes de arrancar."
    )
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

        if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
            raise HTTPException(status_code=401, detail="Emisor del token no válido")

        # tokeninfo devuelve email_verified como cadena "true"/"false"
        if str(info.get("email_verified", "")).lower() != "true":
            raise HTTPException(status_code=401, detail="El email de Google no está verificado")

        return {
            "email":   info["email"],
            "name":    info.get("name", ""),
            "picture": info.get("picture", ""),
        }
    except HTTPException:
        raise
    except Exception:
        logging.getLogger("uvicorn.error").exception("Error verificando el token de Google")
        raise HTTPException(status_code=401, detail="No se pudo verificar el token de Google")


def create_jwt(email: str) -> str:
    """JWT de sesión (HS256). Lleva `jti` único para poder revocarlo (logout)."""
    payload = {
        "sub": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
        "jti": secrets.token_urlsafe(16),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


# ── Sesiones revocadas (logout) ───────────────────────────────────────────────
# Conjunto en memoria jti -> exp (epoch s). Se carga de la tabla `revoked_sessions`
# al arrancar y NO se consulta la BD en cada petición. Es por proceso: con varias
# instancias, un logout solo se aplica de inmediato en la que lo recibe (las demás
# lo ven al reiniciarse). Los tokens antiguos SIN `jti` (sesiones abiertas antes de
# esta versión) siguen siendo válidos hasta caducar y no se pueden revocar.
_revoked: dict[str, float] = {}
_revoked_lock = threading.Lock()


def _purge_revoked(now: float | None = None) -> None:
    now = time.time() if now is None else now
    with _revoked_lock:
        for jti in [j for j, exp in _revoked.items() if exp <= now]:
            del _revoked[jti]


def ensure_revoked_sessions_table() -> None:
    """Migración aditiva e idempotente + carga en memoria de las revocaciones vigentes."""
    from .db import db_cursor
    with db_cursor() as cur:
        cur.execute(
            "CREATE TABLE IF NOT EXISTS revoked_sessions ("
            "jti TEXT PRIMARY KEY, exp TIMESTAMPTZ NOT NULL)"
        )
        cur.execute("ALTER TABLE revoked_sessions ENABLE ROW LEVEL SECURITY")  # sin políticas, como el resto
        cur.execute("DELETE FROM revoked_sessions WHERE exp < now()")
        cur.execute("SELECT jti, EXTRACT(EPOCH FROM exp) AS exp FROM revoked_sessions")
        rows = cur.fetchall()
    with _revoked_lock:
        _revoked.clear()
        for r in rows:
            _revoked[r["jti"]] = float(r["exp"])


def revoke_session(jti: str, exp: float) -> None:
    """Revoca un jti: primero en memoria (efecto inmediato) y luego se persiste."""
    _purge_revoked()
    with _revoked_lock:
        _revoked[jti] = float(exp)
    from .db import db_cursor
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO revoked_sessions (jti, exp) VALUES (%s, to_timestamp(%s)) "
            "ON CONFLICT (jti) DO NOTHING",
            (jti, float(exp)),
        )


def is_revoked(jti: str) -> bool:
    with _revoked_lock:
        exp = _revoked.get(jti)
    return exp is not None and exp > time.time()


def get_current_claims(authorization: str = Header(default="")) -> dict:
    """Dependencia FastAPI: verifica el JWT del header Authorization y devuelve sus
    claims. Exige `exp` y `sub`; cualquier fallo de firma, caducidad o claims da 401."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header requerido")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = pyjwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM],   # algoritmo fijo: sin "none"
            options={"require": ["exp", "sub"]},
        )
    except Exception:  # InvalidTokenError y cualquier otro fallo de parseo: nunca 500
        raise HTTPException(status_code=401, detail="Token de sesión inválido o expirado")
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(status_code=401, detail="Token de sesión inválido o expirado")
    jti = payload.get("jti")
    if jti is not None and (not isinstance(jti, str) or is_revoked(jti)):
        raise HTTPException(status_code=401, detail="Token de sesión inválido o expirado")
    return payload


def get_current_user(authorization: str = Header(default="")) -> str:
    """Dependencia FastAPI: email del usuario autenticado por el JWT."""
    return get_current_claims(authorization)["sub"]


# ── Contraseñas (bcrypt) ──────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hashea una contraseña con bcrypt (cost 12). bcrypt limita a 72 bytes."""
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False
