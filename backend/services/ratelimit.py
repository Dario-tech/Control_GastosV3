"""Limitador de intentos en memoria (sin dependencias). Ventana deslizante + bloqueo temporal.

Estado por proceso: con varias instancias cada una cuenta por separado (aceptable para Render free, 1 instancia).
"""
import os
import time
import threading
from fastapi import HTTPException, Request

# Nº de saltos de proxy de confianza por delante de la app (Render: Cloudflare + balanceador).
# Se toma la entrada X-Forwarded-For contada desde la derecha, para que un cliente no pueda
# falsear la IP añadiendo cabeceras propias.
_TRUSTED_HOPS = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "2")))
_MAX_KEYS = 20000

_lock = threading.Lock()
_hits: dict[str, list[float]] = {}
_blocked: dict[str, float] = {}


def client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    if parts:
        return parts[max(-_TRUSTED_HOPS, -len(parts))]
    return request.client.host if request.client else "unknown"


def _check(key: str, limit: int, window: int, block: int, now: float) -> None:
    until = _blocked.get(key, 0)
    if until > now:
        raise HTTPException(status_code=429, detail="Demasiados intentos. Inténtalo de nuevo más tarde.",
                            headers={"Retry-After": str(int(until - now) + 1)})
    hits = [t for t in _hits.get(key, []) if now - t < window]
    if len(hits) >= limit:
        _blocked[key] = now + block
        _hits.pop(key, None)
        raise HTTPException(status_code=429, detail="Demasiados intentos. Inténtalo de nuevo más tarde.",
                            headers={"Retry-After": str(block)})
    hits.append(now)
    _hits[key] = hits


def _gc(now: float) -> None:
    if len(_hits) + len(_blocked) < _MAX_KEYS:
        return
    for k in [k for k, u in _blocked.items() if u <= now]:
        _blocked.pop(k, None)
    for k in [k for k, h in _hits.items() if not h or now - h[-1] > 3600]:
        _hits.pop(k, None)


def enforce(scope: str, keys: list[str], limit: int, window: int = 60, block: int = 300) -> None:
    """Cuenta un intento por cada clave (p. ej. IP y email); lanza 429 si alguna supera el límite."""
    now = time.monotonic()
    with _lock:
        _gc(now)
        for k in keys:
            _check(f"{scope}:{k}", limit, window, block, now)
