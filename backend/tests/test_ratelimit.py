import pytest
from fastapi import HTTPException

from services import ratelimit


class _Req:
    def __init__(self, xff=None, host="1.2.3.4"):
        self.headers = {"x-forwarded-for": xff} if xff is not None else {}
        self.client = type("C", (), {"host": host})() if host else None


@pytest.fixture
def clock(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: t["now"])
    return t


def test_client_ip_sin_xff_usa_cliente():
    assert ratelimit.client_ip(_Req()) == "1.2.3.4"
    assert ratelimit.client_ip(_Req(host=None)) == "unknown"


def test_client_ip_xff_desde_la_derecha(monkeypatch):
    monkeypatch.setattr(ratelimit, "_TRUSTED_HOPS", 2)
    # el cliente falsea la primera entrada; se toma la penúltima (2 saltos de confianza)
    assert ratelimit.client_ip(_Req("6.6.6.6, 9.9.9.9, 10.0.0.1")) == "9.9.9.9"
    # menos entradas que saltos: la primera disponible
    assert ratelimit.client_ip(_Req("9.9.9.9")) == "9.9.9.9"


def test_enforce_bajo_el_limite_no_lanza(clock):
    for _ in range(3):
        ratelimit.enforce("t", ["k"], limit=3)


def test_enforce_supera_limite_429_y_retry_after(clock):
    for _ in range(3):
        ratelimit.enforce("t", ["k"], limit=3, block=300)
    with pytest.raises(HTTPException) as e:
        ratelimit.enforce("t", ["k"], limit=3, block=300)
    assert e.value.status_code == 429
    assert e.value.headers["Retry-After"] == "300"


def test_bloqueo_persiste_y_expira(clock):
    for _ in range(3):
        ratelimit.enforce("t", ["k"], limit=3, block=300)
    with pytest.raises(HTTPException):
        ratelimit.enforce("t", ["k"], limit=3, block=300)
    clock["now"] += 100
    with pytest.raises(HTTPException) as e:
        ratelimit.enforce("t", ["k"], limit=3, block=300)
    assert e.value.status_code == 429 and int(e.value.headers["Retry-After"]) == 201
    clock["now"] += 201
    ratelimit.enforce("t", ["k"], limit=3, block=300)


def test_ventana_deslizante_libera_intentos(clock):
    for _ in range(3):
        ratelimit.enforce("t", ["k"], limit=3, window=60)
    clock["now"] += 61
    for _ in range(3):
        ratelimit.enforce("t", ["k"], limit=3, window=60)


def test_claves_y_scopes_independientes(clock):
    for _ in range(2):
        ratelimit.enforce("a", ["k"], limit=2)
    with pytest.raises(HTTPException):
        ratelimit.enforce("a", ["k"], limit=2)
    ratelimit.enforce("a", ["otra"], limit=2)
    ratelimit.enforce("b", ["k"], limit=2)


def test_gc_limpia_entradas_caducadas(clock, monkeypatch):
    monkeypatch.setattr(ratelimit, "_MAX_KEYS", 2)
    ratelimit._hits["viejo"] = [clock["now"] - 7200]
    ratelimit._blocked["caducado"] = clock["now"] - 1
    ratelimit.enforce("t", ["nuevo"], limit=5)
    assert "viejo" not in ratelimit._hits and "caducado" not in ratelimit._blocked
    assert "t:nuevo" in ratelimit._hits


# ── 429 en los endpoints ──────────────────────────────────────────────────────

def test_login_429_tras_5_intentos_por_email(client, monkeypatch):
    import main

    async def no_hash(_):
        return None
    monkeypatch.setattr(main, "get_password_hash", no_hash)
    body = {"email": "x@y.com", "password": "loquesea"}
    for _ in range(5):
        assert client.post("/api/auth/login-email", json=body).status_code == 401
    r = client.post("/api/auth/login-email", json=body)
    assert r.status_code == 429
    assert "Retry-After" in r.headers
    # otro email desde la misma IP sigue permitido (límite por IP es 20/min)
    assert client.post("/api/auth/login-email", json={**body, "email": "otro@y.com"}).status_code == 401


def test_login_429_por_ip(client, monkeypatch):
    import main

    async def no_hash(_):
        return None
    monkeypatch.setattr(main, "get_password_hash", no_hash)
    for i in range(20):
        assert client.post("/api/auth/login-email", json={"email": f"u{i}@y.com", "password": "p"}).status_code == 401
    assert client.post("/api/auth/login-email", json={"email": "nuevo@y.com", "password": "p"}).status_code == 429


def test_registro_429_tras_3_intentos_por_email(client, monkeypatch):
    import main

    async def dup(*a):
        return None
    monkeypatch.setattr(main, "create_user_with_password", dup)
    body = {"email": "a@b.com", "name": "A", "password": "clave-test-1234"}
    for _ in range(3):
        assert client.post("/api/auth/register", json=body).status_code == 409
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 429
    assert r.headers["Retry-After"] == "900"


def test_registro_429_por_ip_tras_5(client, monkeypatch):
    import main

    async def dup(*a):
        return None
    monkeypatch.setattr(main, "create_user_with_password", dup)
    for i in range(5):
        r = client.post("/api/auth/register", json={"email": f"u{i}@b.com", "name": "A", "password": "clave-test-1234"})
        assert r.status_code == 409
    r = client.post("/api/auth/register", json={"email": "u9@b.com", "name": "A", "password": "clave-test-1234"})
    assert r.status_code == 429
