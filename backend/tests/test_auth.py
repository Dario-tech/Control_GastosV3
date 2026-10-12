from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from jose import jwt

from services import auth


def test_hash_y_verify_password():
    h = auth.hash_password("contraseña-segura")
    assert h != "contraseña-segura"
    assert auth.verify_password("contraseña-segura", h)
    assert not auth.verify_password("otra", h)


def test_hash_con_salt_distinto():
    assert auth.hash_password("abc12345") != auth.hash_password("abc12345")


def test_verify_hash_vacio_o_invalido():
    assert auth.verify_password("x", "") is False
    assert auth.verify_password("x", None) is False
    assert auth.verify_password("x", "no-es-un-hash") is False


def test_password_truncada_a_72_bytes():
    base = "a" * 72
    h = auth.hash_password(base + "EXTRA")
    assert auth.verify_password(base + "OTRO", h)  # comportamiento documentado de bcrypt


def test_jwt_roundtrip():
    token = auth.create_jwt("a@b.com")
    assert auth.get_current_user(f"Bearer {token}") == "a@b.com"


def test_jwt_expira_en_30_dias():
    p = jwt.decode(auth.create_jwt("a@b.com"), auth.JWT_SECRET, algorithms=["HS256"])
    delta = datetime.utcfromtimestamp(p["exp"]) - datetime.utcnow()
    assert timedelta(days=29, hours=23) < delta <= timedelta(days=30)


def _expect_401(header):
    with pytest.raises(HTTPException) as e:
        auth.get_current_user(header)
    assert e.value.status_code == 401


def test_header_ausente_o_sin_bearer():
    _expect_401("")
    _expect_401("Token abc")


def test_jwt_caducado():
    t = jwt.encode({"sub": "a@b.com", "exp": datetime.utcnow() - timedelta(seconds=5)},
                   auth.JWT_SECRET, algorithm="HS256")
    _expect_401(f"Bearer {t}")


def test_jwt_firma_distinta():
    t = jwt.encode({"sub": "a@b.com", "exp": datetime.utcnow() + timedelta(days=1)},
                   "otra-clave", algorithm="HS256")
    _expect_401(f"Bearer {t}")


def test_jwt_manipulado():
    t = auth.create_jwt("a@b.com")
    head, payload, sig = t.split(".")
    _expect_401(f"Bearer {head}.{payload}x.{sig}")
    _expect_401("Bearer basura")


def test_jwt_alg_none_rechazado():
    import base64, json
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    t = f"{b({'alg': 'none', 'typ': 'JWT'})}.{b({'sub': 'a@b.com'})}."
    _expect_401(f"Bearer {t}")


def test_jwt_sin_sub_da_keyerror():
    """BUG menor: un token con firma válida pero sin 'sub' provoca KeyError (-> 500), no 401.
    Solo lo puede forjar quien tenga JWT_SECRET, así que el impacto es bajo."""
    t = jwt.encode({"exp": datetime.utcnow() + timedelta(days=1)}, auth.JWT_SECRET, algorithm="HS256")
    with pytest.raises(KeyError):
        auth.get_current_user(f"Bearer {t}")


# ── Verificación de Google (httpx simulado, sin red) ─────────────────────────

class _FakeResp:
    def __init__(self, status=200, data=None):
        self.status_code = status
        self._data = data or {}

    def json(self):
        return self._data


def _fake_google(monkeypatch, resp):
    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            return resp
    monkeypatch.setattr(auth.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(auth, "GOOGLE_CLIENT_ID", "cid")


def _info(**over):
    d = {"aud": "cid", "iss": "accounts.google.com", "email": "a@b.com",
         "email_verified": "true", "name": "Ana", "picture": "p"}
    d.update(over)
    return d


def test_google_ok(monkeypatch):
    import asyncio
    _fake_google(monkeypatch, _FakeResp(200, _info()))
    assert asyncio.run(auth.verify_google_token("t")) == {"email": "a@b.com", "name": "Ana", "picture": "p"}


@pytest.mark.parametrize("valor", ["false", False, "", None])
def test_google_email_no_verificado_401(monkeypatch, valor):
    import asyncio
    _fake_google(monkeypatch, _FakeResp(200, _info(email_verified=valor)))
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.verify_google_token("t"))
    assert e.value.status_code == 401


def test_google_email_verified_ausente_401(monkeypatch):
    import asyncio
    d = _info()
    del d["email_verified"]
    _fake_google(monkeypatch, _FakeResp(200, d))
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.verify_google_token("t"))
    assert e.value.status_code == 401


@pytest.mark.parametrize("over", [{"aud": "otra-app"}, {"iss": "evil.com"}])
def test_google_aud_o_iss_invalidos_401(monkeypatch, over):
    import asyncio
    _fake_google(monkeypatch, _FakeResp(200, _info(**over)))
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.verify_google_token("t"))
    assert e.value.status_code == 401
