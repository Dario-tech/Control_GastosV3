"""Endpoints de main.py sin BD: solo rutas que no llegan a consultar nada."""
import pytest


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


PROTEGIDAS = [
    ("get", "/api/auth/me"),
    ("get", "/api/finance"),
    ("get", "/api/transactions/search"),
    ("delete", "/api/transactions/1"),
    ("post", "/api/transaction"),
    ("get", "/api/pending"),
    ("get", "/api/recurring"),
    ("get", "/api/goals"),
    ("delete", "/api/goals/1"),
    ("get", "/api/annual-expenses"),
    ("delete", "/api/annual-expenses/1"),
    ("post", "/api/notify"),
    ("post", "/api/reports/monthly/send"),
    ("get", "/api/debug/transactions"),
]


@pytest.mark.parametrize("method,path", PROTEGIDAS)
def test_sin_token_401(client, method, path):
    assert getattr(client, method)(path).status_code == 401


def test_token_invalido_401(client):
    r = client.get("/api/goals", headers={"Authorization": "Bearer xxx"})
    assert r.status_code == 401


def test_validacion_goals_sin_body_422(client, auth_headers):
    assert client.post("/api/goals", headers=auth_headers, json={}).status_code == 422


def test_registro_password_corta_422(client, monkeypatch):
    import main

    async def create(email, name, pw_hash):
        return {"name": name, "shortcut_token": "tok"}
    monkeypatch.setattr(main, "create_user_with_password", create)
    corta = client.post("/api/auth/register", json={"email": "a@b.com", "name": "A", "password": "x" * 9})
    assert corta.status_code == 422
    limite = client.post("/api/auth/register", json={"email": "a@b.com", "name": "A", "password": "x" * 10})
    assert limite.status_code == 200


def test_registro_email_invalido_422(client):
    r = client.post("/api/auth/register", json={"email": "no-email", "name": "A", "password": "12345678"})
    assert r.status_code == 422


def test_registro_campos_faltantes_422(client):
    assert client.post("/api/auth/register", json={"email": "a@b.com"}).status_code == 422


def test_login_email_usuario_inexistente_401(client, monkeypatch):
    import main

    async def no_hash(_):
        return None
    monkeypatch.setattr(main, "get_password_hash", no_hash)
    r = client.post("/api/auth/login-email", json={"email": "x@y.com", "password": "12345678"})
    assert r.status_code == 401


def test_login_email_ok_y_password_incorrecta(client, monkeypatch):
    import main
    from services.auth import hash_password, get_current_user
    h = hash_password("12345678")

    async def get_hash(_):
        return h

    async def get_user(_):
        return {"name": "Ana", "shortcut_token": "tok"}
    monkeypatch.setattr(main, "get_password_hash", get_hash)
    monkeypatch.setattr(main, "get_user", get_user)

    bad = client.post("/api/auth/login-email", json={"email": "A@Y.com", "password": "mala"})
    assert bad.status_code == 401

    ok = client.post("/api/auth/login-email", json={"email": "A@Y.com", "password": "12345678"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["user"]["email"] == "A@Y.com".lower() and body["user"]["name"] == "Ana"
    assert get_current_user(f"Bearer {body['session_token']}") == "a@y.com"


def test_registro_ok_con_bd_simulada(client, monkeypatch):
    import main
    seen = {}

    async def create(email, name, pw_hash):
        seen.update(email=email, pw_hash=pw_hash)
        return {"name": name, "shortcut_token": "tok"}
    monkeypatch.setattr(main, "create_user_with_password", create)
    r = client.post("/api/auth/register", json={"email": " Ana@X.com ", "name": "", "password": "clave-test-1234"})
    assert r.status_code == 200
    assert seen["email"] == "ana@x.com" and seen["pw_hash"] != "12345678"
    assert r.json()["user"]["name"] == "ana"


def test_registro_duplicado_409(client, monkeypatch):
    import main

    async def create(*a):
        return None
    monkeypatch.setattr(main, "create_user_with_password", create)
    r = client.post("/api/auth/register", json={"email": "a@b.com", "name": "A", "password": "clave-test-1234"})
    assert r.status_code == 409


def test_cron_send_all_sin_secreto_401(client):
    assert client.post("/api/reports/monthly/send-all").status_code == 401
    assert client.post("/api/reports/monthly/send-all", headers={"x-cron-secret": "mal"}).status_code == 401


def test_annual_expense_validaciones_422(client, auth_headers):
    base = {"nombre": "IBI", "importe": 100, "mes": 5}
    casos = [
        {**base, "nombre": "  "},
        {**base, "importe": 0},
        {**base, "mes": 13},
        {**base, "dia": 32},
        {**base, "meses_reparto": []},
        {**base, "meses_reparto": [1, 1]},
        {**base, "meses_reparto": [0, 2]},
    ]
    for c in casos:
        r = client.post("/api/annual-expenses", headers=auth_headers, json=c)
        assert r.status_code == 422, c


def test_foto_y_goals_helpers():
    import main
    from fastapi import HTTPException
    assert main._clean_foto("  ") is None
    assert main._clean_foto("data:image/jpeg;base64,AAA") == "data:image/jpeg;base64,AAA"
    with pytest.raises(HTTPException):
        main._clean_foto("http://x")
    with pytest.raises(HTTPException):
        main._clean_foto("data:image/jpeg;base64," + "A" * main._FOTO_MAX_CHARS)


def test_cors_preflight(client):
    r = client.options("/api/goals", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
