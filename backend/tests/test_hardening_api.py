"""Endurecimiento de main.py: CORS, secreto del cron, atajo iOS, endpoint de
depuración eliminado y login sin enumeración de emails por tiempo."""
import importlib
import logging

import bcrypt
import pytest


# ── CORS ──────────────────────────────────────────────────────────────────────

def test_parse_origins_normaliza():
    import main
    raw = ' "https://App.Example.com/" , \'http://localhost:5173\',,https://x.vercel.app// , https://app.example.com'
    assert main._parse_origins(raw) == [
        "https://app.example.com", "http://localhost:5173", "https://x.vercel.app",
    ]


def test_parse_origins_comodin():
    import main
    assert main._parse_origins("https://a.com, * ") == ["*"]
    assert main._parse_origins('"*"') == ["*"]


@pytest.fixture
def reload_main(monkeypatch):
    """Recarga main con otro CORS_ORIGINS y lo deja como estaba al terminar."""
    import main

    def _reload(value):
        monkeypatch.setenv("CORS_ORIGINS", value)
        return importlib.reload(main)
    yield _reload
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    importlib.reload(main)


def test_cors_origen_normalizado_y_log(reload_main, caplog):
    from fastapi.testclient import TestClient
    caplog.set_level(logging.INFO, logger="uvicorn.error")
    m = reload_main(' "HTTPS://Control-QA.vercel.app/" ')
    assert m.origins == ["https://control-qa.vercel.app"]
    assert "https://control-qa.vercel.app" in caplog.text  # se registra al arrancar
    r = TestClient(m.app).options("/api/goals", headers={
        "Origin": "https://control-qa.vercel.app", "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "https://control-qa.vercel.app"


def test_cors_comodin_permite_todo(reload_main):
    from fastapi.testclient import TestClient
    m = reload_main("*")
    r = TestClient(m.app).options("/api/goals", headers={
        "Origin": "https://cualquiera.example", "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"


# ── Secreto del cron ──────────────────────────────────────────────────────────

def test_cron_secreto_correcto_usa_compare_digest(client, monkeypatch):
    import main
    calls = []
    real = main.hmac.compare_digest

    def spy(a, b):
        calls.append(1)
        return real(a, b)
    monkeypatch.setattr(main.hmac, "compare_digest", spy)

    async def send_all():
        return []
    monkeypatch.setattr(main, "send_monthly_reports_to_all", send_all)

    ok = client.post("/api/reports/monthly/send-all", headers={"x-cron-secret": "test-cron-secret"})
    assert ok.status_code == 200 and ok.json() == {"results": []}
    bad = client.post("/api/reports/monthly/send-all", headers={"x-cron-secret": "test-cron-secreT"})
    assert bad.status_code == 401
    assert len(calls) == 2


def test_cron_sin_secreto_configurado_401(client, monkeypatch):
    import main
    monkeypatch.setattr(main, "CRON_SECRET", "")
    assert client.post("/api/reports/monthly/send-all", headers={"x-cron-secret": ""}).status_code == 401


# ── /api/shortcut/pending ─────────────────────────────────────────────────────

@pytest.fixture
def shortcut_ok(monkeypatch):
    import main
    created = []

    async def email_by_token(token):
        return "user@example.com" if token == "tok-valido" else None

    async def create(email, importe, fecha=None, fuente=None):
        created.append(importe)
        return {"id": 1, "importe": importe}
    monkeypatch.setattr(main, "get_email_by_shortcut_token", email_by_token)
    monkeypatch.setattr(main, "create_pending", create)
    return created


@pytest.mark.parametrize("importe", ["nan", "NaN", "inf", "-inf", "Infinity", 0, -5, "1000000.01", 1e300])
def test_shortcut_importe_invalido_422(client, shortcut_ok, importe):
    r = client.post("/api/shortcut/pending", json={"shortcut_token": "tok-valido", "importe": importe})
    assert r.status_code == 422
    assert shortcut_ok == []


@pytest.mark.parametrize("importe,esperado", [("12,50", 12.5), (1_000_000, 1_000_000.0), ("0.01", 0.01)])
def test_shortcut_importe_valido(client, shortcut_ok, importe, esperado):
    r = client.post("/api/shortcut/pending", json={"shortcut_token": "tok-valido", "importe": importe})
    assert r.status_code == 200
    assert shortcut_ok == [esperado]


def test_shortcut_rate_limit_por_token(client, shortcut_ok):
    body = {"shortcut_token": "tok-valido", "importe": 5}
    for _ in range(30):
        assert client.post("/api/shortcut/pending", json=body).status_code == 200
    r = client.post("/api/shortcut/pending", json=body)
    assert r.status_code == 429
    # Otro token no se ve afectado (aunque sea inválido: 401, no 429)
    assert client.post("/api/shortcut/pending", json={"token": "otro", "importe": 5}).status_code == 401


def test_shortcut_token_invalido_tambien_limitado(client, shortcut_ok):
    body = {"shortcut_token": "tanteo", "importe": 5}
    for _ in range(30):
        assert client.post("/api/shortcut/pending", json=body).status_code == 401
    assert client.post("/api/shortcut/pending", json=body).status_code == 429


# ── Endpoint de depuración eliminado ──────────────────────────────────────────

def test_debug_transactions_eliminado(client, auth_headers):
    import main
    assert client.get("/api/debug/transactions", headers=auth_headers).status_code == 404
    assert not any(getattr(r, "path", "").startswith("/api/debug") for r in main.app.routes)


# ── Login: bcrypt de relleno cuando no hay hash ───────────────────────────────

def test_dummy_hash_es_bcrypt_valido_coste_12():
    import main
    h = main._DUMMY_PASSWORD_HASH.encode()
    assert h.startswith(b"$2b$12$")
    assert bcrypt.checkpw(b"cualquier-cosa", h) is False  # no lanza: es un hash bien formado


@pytest.mark.parametrize("hash_bd", [None, ""])
def test_login_sin_hash_ejecuta_bcrypt_de_relleno(client, monkeypatch, hash_bd):
    import main
    calls = []

    async def get_hash(_):
        return hash_bd

    def spy(password, password_hash):
        calls.append(password_hash)
        return False
    monkeypatch.setattr(main, "get_password_hash", get_hash)
    monkeypatch.setattr(main, "verify_password", spy)
    r = client.post("/api/auth/login-email", json={"email": "nadie@x.com", "password": "12345678"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Email o contraseña incorrectos"
    assert calls == [main._DUMMY_PASSWORD_HASH]


def test_login_con_hash_no_usa_relleno(client, monkeypatch):
    import main
    calls = []

    async def get_hash(_):
        return "hash-real"

    def spy(password, password_hash):
        calls.append(password_hash)
        return False
    monkeypatch.setattr(main, "get_password_hash", get_hash)
    monkeypatch.setattr(main, "verify_password", spy)
    r = client.post("/api/auth/login-email", json={"email": "a@x.com", "password": "12345678"})
    assert r.status_code == 401
    assert calls == ["hash-real"]
