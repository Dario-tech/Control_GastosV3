import os
import json
from fastapi import HTTPException

# Formato de USERS_CONFIG (env var en Render):
# {"mario@gmail.com": {"name": "Mario", "sheet_url": "https://script.google.com/..."}}
def _load_config() -> dict:
    raw = os.getenv("USERS_CONFIG", "{}")
    try:
        return json.loads(raw)
    except Exception:
        return {}


def get_user_sheet_url(email: str) -> str:
    config = _load_config()
    user = config.get(email)
    if not user:
        raise HTTPException(status_code=403, detail=f"Usuario '{email}' no autorizado. Contacta al administrador.")
    url = user.get("sheet_url", "")
    if not url:
        raise HTTPException(status_code=500, detail=f"Usuario '{email}' no tiene Sheet configurado.")
    return url


def get_user_info(email: str) -> dict:
    return _load_config().get(email, {})
