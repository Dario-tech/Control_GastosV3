"""Caracteres de control (NUL, C0) en textos: 4xx genérico, nunca 500/502 ni BD; los
textos legítimos siguen funcionando. Y límite de ritmo de /api/goals/{id}/share."""
import pytest

import main

NUL = "\u0000"
BAD = [NUL, "a" + NUL + "b", "\u0001x", "x\u001fy", "x\u007f"]


async def _ok(*a, **k):
    return {"status": "ok"}


async def _boom(*a, **k):
    raise AssertionError("no debe llegar a la BD")


def _no_db(monkeypatch):
    for n in ("post_transaction", "update_transaction", "update_transaction_comment", "create_goal",
              "update_goal", "create_annual_expense", "update_annual_expense", "share_goal",
              "get_password_hash", "create_user_with_password", "create_pending_dedup",
              "create_pending", "get_email_by_shortcut_token"):
        monkeypatch.setattr(main, n, _boom)


def _assert_generico(r, valor):
    assert 400 <= r.status_code < 500, r.text
    assert "\\u0000" not in r.text and valor not in r.text


TX = {"importe": 5, "tipo": "Gasto Variable", "concepto": "Café", "fecha": "2025-01-10"}
GOAL = {"nombre": "Viaje", "objetivo": 100, "emoji": "🎯"}
ANN = {"nombre": "IBI", "importe": 100, "mes": 3, "dia": 1}


@pytest.mark.parametrize("bad", BAD)
@pytest.mark.parametrize("method,url,body,campo", [
    ("post", "/api/transaction", TX, "concepto"),
    ("post", "/api/transaction", TX, "comentario"),
    ("patch", "/api/transactions/1", {"concepto": "x"}, "concepto"),
    ("patch", "/api/transactions/1", {"comentario": "x"}, "comentario"),
    ("patch", "/api/transactions/1/comment", {"comentario": "x"}, "comentario"),
    ("post", "/api/goals", GOAL, "nombre"),
    ("post", "/api/goals", GOAL, "emoji"),
    ("post", "/api/goals", GOAL, "imagen_url"),
    ("patch", "/api/goals/1", GOAL, "nombre"),
    ("patch", "/api/goals/1", GOAL, "emoji"),
    ("patch", "/api/goals/1", GOAL, "imagen_url"),
    ("post", "/api/annual-expenses", ANN, "nombre"),
    ("patch", "/api/annual-expenses/1", ANN, "nombre"),
    ("post", "/api/goals/1/share", {}, "email"),
    ("post", "/api/pending", {"importe": 5}, "comercio"),
    ("post", "/api/shortcut/pending", {"importe": 5, "shortcut_token": "t"}, "comercio"),
])
def test_control_rechazado_con_sesion(client, auth_headers, monkeypatch, method, url, body, campo, bad):
    _no_db(monkeypatch)
    payload = dict(body)
    payload[campo] = ("https://x.com/" + bad) if campo == "imagen_url" else bad
    r = getattr(client, method)(url, json=payload, headers=auth_headers)
    _assert_generico(r, bad if len(bad) > 1 else "zz-no-aparece")


@pytest.mark.parametrize("bad", BAD)
def test_login_email_con_control(client, monkeypatch, bad):
    _no_db(monkeypatch)
    r = client.post("/api/auth/login-email", json={"email": "a" + bad + "@b.com", "password": "x" * 12})
    assert r.status_code in (401, 422)


def test_login_email_password_nul(client, monkeypatch):
    _no_db(monkeypatch)
    r = client.post("/api/auth/login-email", json={"email": "a@b.com", "password": "x" + NUL})
    assert r.status_code == 422


@pytest.mark.parametrize("bad", BAD)
def test_register_con_control(client, monkeypatch, bad):
    _no_db(monkeypatch)
    for body in ({"email": "a" + bad + "@b.com", "name": "N", "password": "x" * 12},
                 {"email": "a@b.com", "name": "N" + bad, "password": "x" * 12}):
        r = client.post("/api/auth/register", json=body)
        assert 400 <= r.status_code < 500


def test_textos_legitimos_siguen_dando_200(client, auth_headers, monkeypatch):
    for n in ("post_transaction", "update_transaction", "update_transaction_comment", "create_goal",
              "update_goal", "create_annual_expense", "update_annual_expense", "share_goal"):
        monkeypatch.setattr(main, n, _ok)

    async def _bc():
        return None
    monkeypatch.setattr(main, "_broadcast", _bc)
    h = auth_headers
    coment = "línea 1\nlínea 2\r\n\tañ ☕ 🎉"
    assert client.post("/api/transaction", headers=h,
                       json={**TX, "concepto": "Café ☕ Ñandú", "comentario": coment}).status_code == 200
    assert client.patch("/api/transactions/1", headers=h,
                        json={"concepto": "Cañas 🍺", "comentario": coment}).status_code == 200
    assert client.patch("/api/transactions/1/comment", headers=h, json={"comentario": coment}).status_code == 200
    assert client.post("/api/goals", headers=h,
                       json={**GOAL, "nombre": "Vacaciones ☀️ año", "imagen_url": "https://x.com/a.gif"}).status_code == 200
    assert client.patch("/api/goals/1", headers=h, json={**GOAL, "nombre": "Ñu 🎯"}).status_code == 200
    assert client.post("/api/annual-expenses", headers=h, json={**ANN, "nombre": "Seguro del cóche ☂"}).status_code == 200
    assert client.patch("/api/annual-expenses/1", headers=h, json={**ANN, "nombre": "Seguro ☂"}).status_code == 200
    assert client.post("/api/goals/1/share", headers=h, json={"email": "amigo@example.com"}).status_code == 200


def test_has_surrogates_multiline():
    assert main._has_surrogates("a\nb") is True
    assert main._has_surrogates("a\nb\r\tc", multiline=True) is False
    assert main._has_surrogates("a\x00b", multiline=True) is True
    assert main._has_surrogates("Café ☕ 🎉 ñ") is False


# ── Límite de ritmo de share ─────────────────────────────────────────────────

def test_share_limite_por_hora(client, auth_headers, monkeypatch):
    monkeypatch.setattr(main, "share_goal", _ok)
    for _ in range(10):
        assert client.post("/api/goals/1/share", headers=auth_headers, json={"email": "a@b.com"}).status_code == 200
    r = client.post("/api/goals/1/share", headers=auth_headers, json={"email": "a@b.com"})
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_share_limite_por_usuario_no_global(client, monkeypatch):
    from services.auth import create_jwt
    monkeypatch.setattr(main, "share_goal", _ok)
    h1 = {"Authorization": f"Bearer {create_jwt('u1@example.com')}"}
    h2 = {"Authorization": f"Bearer {create_jwt('u2@example.com')}"}
    for _ in range(11):
        client.post("/api/goals/1/share", headers=h1, json={"email": "a@b.com"})
    assert client.post("/api/goals/1/share", headers=h1, json={"email": "a@b.com"}).status_code == 429
    assert client.post("/api/goals/1/share", headers=h2, json={"email": "a@b.com"}).status_code == 200


def test_share_limite_diario(client, auth_headers, monkeypatch):
    from services import ratelimit
    monkeypatch.setattr(main, "share_goal", _ok)
    t = [1000.0]
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: t[0])
    for i in range(30):
        t[0] += 400  # <10 por hora, 30 en el día
        assert client.post("/api/goals/1/share", headers=auth_headers, json={"email": "a@b.com"}).status_code == 200
    t[0] += 400
    assert client.post("/api/goals/1/share", headers=auth_headers, json={"email": "a@b.com"}).status_code == 429


# ── el nombre de un comercio de Apple Pay con saltos de línea o tabuladores NO pierde el pago ──

def test_atajo_y_pendiente_toleran_saltos_de_linea_en_el_comercio():
    from main import _dict_has_surrogates
    assert _dict_has_surrogates({"comercio": "Mercadona\nMadrid\tCentro", "importe": "12,40 €"}) is False
    assert _dict_has_surrogates({"comercio": "x\x00y"}) is True      # NUL sigue rechazado
    assert _dict_has_surrogates({"comercio": "a\x07b"}) is True      # otros controles también
    assert _dict_has_surrogates({"comercio": "ok \ud800"}) is True   # sustitutos sueltos
