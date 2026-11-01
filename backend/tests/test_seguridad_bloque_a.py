"""Bloque A de seguridad: registro cerrado, validación y topes de entrada, cabeceras,
docs apagadas y sesión revocable (logout). Sin BD real: se simulan los accesos."""
import asyncio
import contextlib
import json
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException

from services import auth, users

CERRADO_MSG = "El registro está cerrado. Pídele acceso al administrador."
H_JSON = {"content-type": "application/json"}


# ── A1: registro cerrado ─────────────────────────────────────────────────────

@pytest.fixture
def cerrado(monkeypatch):
    monkeypatch.delenv("ALLOW_REGISTER", raising=False)


@pytest.mark.parametrize("valor,abierto", [
    ("true", True), ("TRUE", True), ("1", True), ("yes", True), (" Yes ", True),
    ("", False), ("false", False), ("0", False), ("no", False), ("si", False), ("on", False),
])
def test_allow_register_valores(monkeypatch, valor, abierto):
    monkeypatch.setenv("ALLOW_REGISTER", valor)
    assert users.registration_open() is abierto


def test_allow_register_ausente_es_cerrado(cerrado):
    assert users.registration_open() is False


def test_register_cerrado_403_uniforme(client, cerrado, monkeypatch):
    import main
    llamadas = []

    async def create(*a):
        llamadas.append(a)
        return None  # "ya existe": no debe llegar a consultarse
    monkeypatch.setattr(main, "create_user_with_password", create)
    cuerpo = {"email": "a@b.com", "name": "A", "password": "clave-test-1234"}
    r1 = client.post("/api/auth/register", json=cuerpo)
    r2 = client.post("/api/auth/register", json={**cuerpo, "email": "otro@b.com"})
    assert r1.status_code == r2.status_code == 403
    assert r1.json() == r2.json() == {"detail": CERRADO_MSG}
    assert llamadas == []


def test_register_abierto_mantiene_409_y_200(client, monkeypatch):
    import main
    estado = {"existe": True}

    async def create(email, name, h):
        return None if estado["existe"] else {"name": name}
    monkeypatch.setattr(main, "create_user_with_password", create)
    cuerpo = {"email": "a@b.com", "name": "A", "password": "clave-test-1234"}
    assert client.post("/api/auth/register", json=cuerpo).status_code == 409
    estado["existe"] = False
    assert client.post("/api/auth/register", json=cuerpo).status_code == 200


def test_login_email_inexistente_sigue_401_generico_con_registro_cerrado(client, cerrado, monkeypatch):
    import main

    async def sin_hash(email):
        return None
    monkeypatch.setattr(main, "get_password_hash", sin_hash)
    r = client.post("/api/auth/login-email", json={"email": "nadie@b.com", "password": "x"})
    assert r.status_code == 401 and r.json() == {"detail": "Email o contraseña incorrectos"}


class _Cur:
    def __init__(self, row):
        self.row, self.sql = row, []

    def execute(self, sql, params=None):
        self.sql.append(sql)

    def fetchone(self):
        return self.row


def _fake_cursor(cur):
    @contextlib.contextmanager
    def _db():
        yield cur
    return _db


def test_ensure_user_cerrado_usuario_nuevo_403(cerrado, monkeypatch):
    cur = _Cur(None)  # el UPDATE no encuentra fila
    monkeypatch.setattr(users, "db_cursor", _fake_cursor(cur))
    with pytest.raises(HTTPException) as e:
        asyncio.run(users.ensure_user("nuevo@b.com", "N"))
    assert e.value.status_code == 403 and e.value.detail == CERRADO_MSG
    assert not any("INSERT" in s for s in cur.sql)


def test_ensure_user_cerrado_usuario_existente_entra(cerrado, monkeypatch):
    cur = _Cur({"email": "a@b.com", "name": "A", "shortcut_token": "t"})
    monkeypatch.setattr(users, "db_cursor", _fake_cursor(cur))
    r = asyncio.run(users.ensure_user("a@b.com", "A"))
    assert r["email"] == "a@b.com"
    assert not any("INSERT" in s for s in cur.sql)


def test_ensure_user_abierto_inserta_sin_password_hash(monkeypatch):
    cur = _Cur({"email": "n@b.com", "name": "N", "shortcut_token": "t"})
    monkeypatch.setattr(users, "db_cursor", _fake_cursor(cur))
    asyncio.run(users.ensure_user("n@b.com", "N"))
    sql = cur.sql[0]
    assert "INSERT INTO users (email, name, shortcut_token)" in sql and "password_hash" not in sql


def test_login_google_usuario_nuevo_403_con_registro_cerrado(client, cerrado, monkeypatch):
    import main

    async def google(token):
        return {"email": "nuevo@b.com", "name": "N", "picture": ""}
    monkeypatch.setattr(main, "verify_google_token", google)
    monkeypatch.setattr(users, "db_cursor", _fake_cursor(_Cur(None)))
    r = client.post("/api/auth/login", json={"token": "g"})
    assert r.status_code == 403 and r.json() == {"detail": CERRADO_MSG}


def test_login_google_usuario_existente_entra_con_registro_cerrado(client, cerrado, monkeypatch):
    import main

    async def google(token):
        return {"email": "a@b.com", "name": "A", "picture": ""}
    monkeypatch.setattr(main, "verify_google_token", google)
    monkeypatch.setattr(users, "db_cursor",
                        _fake_cursor(_Cur({"email": "a@b.com", "name": "A", "shortcut_token": "t"})))
    r = client.post("/api/auth/login", json={"token": "g"})
    assert r.status_code == 200 and r.json()["user"]["email"] == "a@b.com"


# ── A1: validación del registro ──────────────────────────────────────────────

@pytest.mark.parametrize("campos", [
    {"email": "a" * 250 + "@b.com"},               # > 254
    {"email": "sin-arroba"},
    {"name": "n" * 101},
    {"password": "corta"},
    {"password": "p" * 129},
    {"email": "a\ud800@b.com"},
])
def test_register_validacion_422(client, campos):
    cuerpo = json.dumps({"email": "a@b.com", "name": "A", "password": "clave-test-1234", **campos})
    r = client.post("/api/auth/register", content=cuerpo.encode(), headers=H_JSON)
    assert r.status_code == 422


def test_register_limites_aceptados(client, monkeypatch):
    import main

    async def create(email, name, h):
        return {"name": name}
    monkeypatch.setattr(main, "create_user_with_password", create)
    email = "a" * (254 - len("@b.com")) + "@b.com"
    assert len(email) == 254
    r = client.post("/api/auth/register", json={"email": email, "name": "n" * 100, "password": "p" * 128})
    assert r.status_code == 200


def test_login_email_surrogate_422_no_500(client):
    cuerpo = json.dumps({"email": "a@b.com", "password": "\ud800"})
    assert client.post("/api/auth/login-email", content=cuerpo.encode(), headers=H_JSON).status_code == 422


# ── A1: compartir meta sin enumeración (endpoint) ────────────────────────────

def test_share_email_largo_422(client, auth_headers):
    r = client.post("/api/goals/1/share", json={"email": "a" * 255}, headers=auth_headers)
    assert r.status_code == 422


# ── A2: transacciones ────────────────────────────────────────────────────────

def _tx(**kw):
    base = {"importe": 10, "tipo": "Gasto Variable", "concepto": "Café"}
    base.update(kw)
    return base


def _post_tx(client, headers, cuerpo):
    return client.post("/api/transaction", content=json.dumps(cuerpo).encode(),
                       headers={**headers, **H_JSON})


@pytest.mark.parametrize("campos", [
    {"tipo": "Otro"},
    {"tipo": ""},
    {"concepto": ""},
    {"concepto": "   "},
    {"concepto": "x" * 61},
    {"comentario": "y" * 501},
    {"fecha": "2026-13-45"},
    {"fecha": "no-es-fecha"},
    {"fecha": "1999-12-31"},
    {"fecha": "2999-01-01"},
    {"concepto": "caf\ud800"},
    {"comentario": "a\udc00"},
    {"source": "s" * 33},
])
def test_transaction_valores_invalidos_422(client, auth_headers, monkeypatch, campos):
    import main

    async def no_debe(*a, **k):
        raise AssertionError("no debe llegar a guardar")
    monkeypatch.setattr(main, "post_transaction", no_debe)
    r = _post_tx(client, auth_headers, _tx(**campos))
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("raw", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_transaction_importe_no_finito_422(client, auth_headers, raw):
    cuerpo = '{"importe": %s, "tipo": "Gasto Variable", "concepto": "x"}' % raw
    r = client.post("/api/transaction", content=cuerpo.encode(), headers={**auth_headers, **H_JSON})
    assert r.status_code == 422


def test_transaction_valida_ok_y_normaliza(client, auth_headers, monkeypatch):
    import main
    visto = {}

    async def guardar(importe, tipo, concepto, email, source, fecha, comentario, id_cliente=None):
        visto.update(tipo=tipo, concepto=concepto, fecha=fecha, comentario=comentario)
        return {"status": "ok", "id": 1, "fecha": fecha}

    async def nada():
        return None
    monkeypatch.setattr(main, "post_transaction", guardar)
    monkeypatch.setattr(main, "_broadcast", nada)
    hoy_mas = f"{datetime.now().year + 1}-12-31"
    r = _post_tx(client, auth_headers, _tx(concepto="  Café  ", fecha=hoy_mas, comentario=" hola "))
    assert r.status_code == 200
    assert visto == {"tipo": "Gasto Variable", "concepto": "Café", "fecha": hoy_mas, "comentario": "hola"}
    assert _post_tx(client, auth_headers, _tx(fecha="2000-01-01", concepto="x" * 60,
                                              comentario="y" * 500)).status_code == 200


def test_comment_patch_validacion(client, auth_headers):
    r = client.patch("/api/transactions/7/comment", json={"comentario": "y" * 501}, headers=auth_headers)
    assert r.status_code == 422
    r = client.patch("/api/transactions/7/comment", content=json.dumps({"comentario": "\ud800"}).encode(),
                     headers={**auth_headers, **H_JSON})
    assert r.status_code == 422


@pytest.mark.parametrize("campos", [
    {"tipo": "Otro"}, {"concepto": ""}, {"concepto": "x" * 61}, {"comentario": "c" * 501},
    {"concepto": "\ud800"},
])
def test_categorize_validacion_422(client, auth_headers, monkeypatch, campos):
    import main

    async def no_debe(*a, **k):
        raise AssertionError("no debe llegar al servicio")
    monkeypatch.setattr(main, "categorize_pending", no_debe)
    cuerpo = json.dumps({"tipo": "Gasto Variable", "concepto": "Café", **campos})
    r = client.post("/api/pending/3/categorize", content=cuerpo.encode(), headers={**auth_headers, **H_JSON})
    assert r.status_code == 422


def test_pending_surrogate_422(client, auth_headers):
    cuerpo = json.dumps({"importe": 5, "comercio": "\ud800"})
    r = client.post("/api/pending", content=cuerpo.encode(), headers={**auth_headers, **H_JSON})
    assert r.status_code == 422


# ── A2: metas ────────────────────────────────────────────────────────────────

def _goal(**kw):
    base = {"nombre": "Viaje", "objetivo": 1000, "emoji": "🎯"}
    base.update(kw)
    return base


@pytest.fixture
def goals_ok(monkeypatch):
    import main
    visto = {}

    async def crear(email, nombre, objetivo, emoji, fecha, imagen_url=None):
        visto.update(nombre=nombre, objetivo=objetivo, emoji=emoji, fecha=fecha, imagen_url=imagen_url)
        return {"id": 1}

    async def actualizar(goal_id, email, nombre, objetivo, emoji, fecha, imagen_url=None):
        visto.update(nombre=nombre, objetivo=objetivo, fecha=fecha)
        return {"id": goal_id}
    monkeypatch.setattr(main, "create_goal", crear)
    monkeypatch.setattr(main, "update_goal", actualizar)
    return visto


@pytest.mark.parametrize("campos", [
    {"nombre": "n" * 61},
    {"nombre": "  "},
    {"objetivo": 0},
    {"objetivo": -5},
    {"objetivo": 100_000_001},
    {"emoji": "e" * 17},
    {"imagen_url": "ftp://x.com/a.gif"},
    {"imagen_url": "javascript:alert(1)"},
    {"imagen_url": "https://x.com/" + "a" * 2048},
    {"fecha": "2026-02-30"},
    {"fecha": "ayer"},
    {"fecha": "1999-01-01"},
    {"nombre": "\ud800"},
])
@pytest.mark.parametrize("metodo,ruta", [("post", "/api/goals"), ("patch", "/api/goals/1")])
def test_goal_validacion_422(client, auth_headers, goals_ok, campos, metodo, ruta):
    r = getattr(client, metodo)(ruta, content=json.dumps(_goal(**campos)).encode(),
                                headers={**auth_headers, **H_JSON})
    assert r.status_code == 422, r.text
    assert goals_ok == {}


@pytest.mark.parametrize("raw", ["NaN", "Infinity", "1e999"])
def test_goal_objetivo_no_finito_422(client, auth_headers, goals_ok, raw):
    cuerpo = '{"nombre": "Viaje", "objetivo": %s}' % raw
    r = client.post("/api/goals", content=cuerpo.encode(), headers={**auth_headers, **H_JSON})
    assert r.status_code == 422 and goals_ok == {}


def test_goal_ok_normaliza_y_acepta_limites(client, auth_headers, goals_ok):
    r = client.post("/api/goals", headers=auth_headers, json=_goal(
        nombre=" " + "n" * 60 + " ", objetivo=100_000_000, emoji="e" * 16,
        fecha="2027-05-01", imagen_url="https://x.com/" + "a" * (2048 - len("https://x.com/"))))
    assert r.status_code == 200
    assert goals_ok["nombre"] == "n" * 60 and goals_ok["objetivo"] == 100_000_000
    r = client.post("/api/goals", headers=auth_headers, json=_goal(fecha=""))   # fecha vacía = sin fecha
    assert r.status_code == 200 and goals_ok["fecha"] is None


@pytest.mark.parametrize("importe", [0, -1, 1_000_001])
def test_aportacion_importe_fuera_de_rango_422(client, auth_headers, monkeypatch, importe):
    from services import goals

    async def miembro(goal_id, email):
        return None
    monkeypatch.setattr(goals, "_require_member", miembro)
    r = client.post("/api/goals/1/contribute", json={"importe": importe}, headers=auth_headers)
    assert r.status_code == 422


def test_aportacion_no_finita_422(client, auth_headers, monkeypatch):
    from services import goals

    async def miembro(goal_id, email):
        return None
    monkeypatch.setattr(goals, "_require_member", miembro)
    r = client.post("/api/goals/1/contribute", content=b'{"importe": NaN}', headers={**auth_headers, **H_JSON})
    assert r.status_code == 422


# ── A2: gastos fijos anuales ─────────────────────────────────────────────────

def _anual(**kw):
    base = {"nombre": "IBI", "importe": 300, "mes": 6, "dia": 1, "avisar": True, "dias_aviso": 15}
    base.update(kw)
    return base


@pytest.mark.parametrize("campos", [
    {"nombre": "n" * 61}, {"nombre": ""}, {"importe": 0}, {"importe": 1_000_001},
    {"dia": 0}, {"dia": 32}, {"dias_aviso": -1}, {"dias_aviso": 366},
    {"mes": 0}, {"mes": 13}, {"meses_reparto": [0, 1]}, {"meses_reparto": [13]},
    {"meses_reparto": [1, 1]}, {"meses_reparto": []},
])
def test_gasto_anual_validacion_422(client, auth_headers, monkeypatch, campos):
    import main

    async def no_debe(*a, **k):
        raise AssertionError("no debe llegar al servicio")
    monkeypatch.setattr(main, "create_annual_expense", no_debe)
    r = client.post("/api/annual-expenses", json=_anual(**campos), headers=auth_headers)
    assert r.status_code == 422, r.text


def test_gasto_anual_limites_ok(client, auth_headers, monkeypatch):
    import main

    async def crear(*a, **k):
        return {"id": 1}
    monkeypatch.setattr(main, "create_annual_expense", crear)
    r = client.post("/api/annual-expenses", headers=auth_headers,
                    json=_anual(nombre="n" * 60, dia=31, dias_aviso=365, importe=1_000_000))
    assert r.status_code == 200


# ── A2: atajo iOS y topes de cuerpo ──────────────────────────────────────────

@pytest.mark.parametrize("token", [123, ["a"], {"a": 1}, True, "t" * 129, "ab\ud800"])
def test_atajo_token_raro_401_no_500(client, token):
    cuerpo = json.dumps({"shortcut_token": token, "importe": 5})
    r = client.post("/api/shortcut/pending", content=cuerpo.encode(), headers=H_JSON)
    assert r.status_code == 401, r.text


def test_atajo_cuerpo_mayor_4kb_413_antes_de_validar_token(client, monkeypatch):
    import main

    async def no_debe(token):
        raise AssertionError("no debe consultarse el token")
    monkeypatch.setattr(main, "get_email_by_shortcut_token", no_debe)
    cuerpo = json.dumps({"shortcut_token": "t", "importe": 5, "comercio": "c" * 5000})
    r = client.post("/api/shortcut/pending", content=cuerpo.encode(), headers=H_JSON)
    assert r.status_code == 413
    assert "4 KB" in r.json()["detail"]


def test_atajo_cuerpo_chunked_413(client):
    def trozos():
        for _ in range(10):
            yield b"x" * 1024   # 10 KB sin Content-Length (Transfer-Encoding: chunked)
    r = client.post("/api/shortcut/pending", content=trozos(), headers=H_JSON)
    assert r.status_code == 413


def test_tope_global_64kb(client, auth_headers):
    grande = json.dumps(_tx(comentario="y" * (65 * 1024)))
    assert client.post("/api/transaction", content=grande.encode(),
                       headers={**auth_headers, **H_JSON}).status_code == 413
    justo = json.dumps(_tx(comentario="y" * 600))
    assert _post_tx(client, auth_headers, json.loads(justo)).status_code != 413


def test_aportacion_con_foto_conserva_tope_propio(client, auth_headers, monkeypatch):
    from services import goals

    async def miembro(goal_id, email):
        return None
    monkeypatch.setattr(goals, "_require_member", miembro)
    foto = "data:image/jpeg;base64," + "A" * 300_000       # > 64 KB, < 1,2 MB
    r = client.post("/api/goals/1/contribute", json={"importe": 0, "foto": foto}, headers=auth_headers)
    assert r.status_code == 422                                # llega al endpoint (importe 0), no 413
    enorme = "data:image/jpeg;base64," + "A" * 1_300_000
    r = client.post("/api/goals/1/contribute", json={"importe": 5, "foto": enorme}, headers=auth_headers)
    assert r.status_code == 413


def test_categorias_y_prefs_conservan_128kb(client, auth_headers):
    # 100 KB: pasa el middleware (tope de 128 KB); lo corta después el servicio (64 KB de JSON)
    cuerpo = json.dumps({"data": "x" * (100 * 1024)})
    r = client.put("/api/prefs/tour", content=cuerpo.encode(), headers={**auth_headers, **H_JSON})
    assert "128 KB" not in str(r.json().get("detail", ""))
    cuerpo = json.dumps({"data": "x" * (130 * 1024)})
    r = client.put("/api/prefs/tour", content=cuerpo.encode(), headers={**auth_headers, **H_JSON})
    assert r.status_code == 413 and "128 KB" in r.json()["detail"]


def test_413_lleva_cors_y_cabeceras(client):
    r = client.post("/api/shortcut/pending", content=b"x" * 5000,
                    headers={**H_JSON, "Origin": "http://localhost:5173"})
    assert r.status_code == 413
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"


# ── A3: cabeceras y docs ─────────────────────────────────────────────────────

def _cab(r):
    return {k.lower(): v for k, v in r.headers.items()}


def test_cabeceras_en_api_incluye_4xx_y_cors(client):
    r = client.get("/api/notify-no-existe", headers={"Origin": "http://localhost:5173"})
    r = client.post("/api/notify", headers={"Origin": "http://localhost:5173"})   # 401 sin JWT
    assert r.status_code == 401
    h = _cab(r)
    assert h["x-content-type-options"] == "nosniff"
    assert h["referrer-policy"] == "no-referrer"
    assert h["x-frame-options"] == "DENY"
    assert h["cache-control"] == "no-store"
    assert h["access-control-allow-origin"] == "http://localhost:5173"


def test_422_de_validacion_lleva_cabeceras(client, auth_headers):
    r = client.post("/api/goals", json={"nombre": 5}, headers=auth_headers)
    assert r.status_code == 422 and _cab(r)["cache-control"] == "no-store"


def test_health_no_cambia_cache_control_pero_si_otras_cabeceras(client):
    r = client.get("/api/health")
    h = _cab(r)
    assert r.status_code == 200 and "cache-control" not in h
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"


def test_shortcut_token_no_duplica_cache_control(client, auth_headers, monkeypatch):
    import main

    async def tok(email):
        return "abc"
    monkeypatch.setattr(main, "get_or_create_shortcut_token", tok)
    r = client.get("/api/shortcut/token", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers.get_list("cache-control") == ["no-store"]


def _run_asgi(app, path):
    enviados = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(m):
        enviados.append(m)
    asyncio.run(app({"type": "http", "path": path, "method": "GET", "headers": []}, receive, send))
    return enviados


def test_events_conserva_su_cache_control():
    import main

    async def sse(scope, receive, send):
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"cache-control", b"no-cache"), (b"content-type", b"text/event-stream")]})
        await send({"type": "http.response.body", "body": b"event: ping\n\n"})
    msgs = _run_asgi(main.SecurityHeadersMiddleware(sse), "/api/events")
    h = dict(msgs[0]["headers"])
    assert h[b"cache-control"] == b"no-cache" and h[b"x-content-type-options"] == b"nosniff"


def test_error_no_controlado_da_500_generico_con_cabeceras():
    import main

    async def rota(scope, receive, send):
        raise RuntimeError("secreto interno")
    msgs = _run_asgi(main.SecurityHeadersMiddleware(rota), "/api/algo")
    assert msgs[0]["status"] == 500
    assert b"secreto" not in msgs[1]["body"] and b"Error interno" in msgs[1]["body"]
    h = dict(msgs[0]["headers"])
    assert h[b"cache-control"] == b"no-store" and h[b"x-frame-options"] == b"DENY"


@pytest.mark.parametrize("ruta", ["/docs", "/redoc", "/openapi.json"])
def test_docs_apagadas_por_defecto(client, ruta):
    assert client.get(ruta).status_code == 404


def test_enable_docs_valores(monkeypatch):
    import main
    for v, esperado in [("true", True), ("1", True), ("yes", True), ("", False), ("false", False)]:
        monkeypatch.setenv("ENABLE_DOCS", v)
        assert main._docs_enabled() is esperado
    monkeypatch.delenv("ENABLE_DOCS")
    assert main._docs_enabled() is False


def test_docs_se_encienden_con_enable_docs(monkeypatch):
    import importlib
    import main
    from fastapi.testclient import TestClient
    monkeypatch.setenv("ENABLE_DOCS", "true")
    m = importlib.reload(main)
    try:
        assert TestClient(m.app).get("/openapi.json").status_code == 200
    finally:
        monkeypatch.delenv("ENABLE_DOCS")
        importlib.reload(main)


# ── A4: sesión revocable ─────────────────────────────────────────────────────

@pytest.fixture
def revocaciones(monkeypatch):
    """Revocaciones en memoria + BD simulada; se vacía al terminar."""
    cur = _Cur(None)
    from services import db
    monkeypatch.setattr(db, "db_cursor", _fake_cursor(cur))
    auth._revoked.clear()
    yield cur
    auth._revoked.clear()


def _bearer(t):
    return {"Authorization": f"Bearer {t}"}


def test_logout_invalida_el_token(client, revocaciones):
    t = auth.create_jwt("a@b.com")
    assert client.post("/api/notify", headers=_bearer(t)).status_code == 200
    r = client.post("/api/auth/logout", headers=_bearer(t))
    assert r.status_code == 200 and r.json() == {"status": "ok", "revoked": True}
    assert any("INSERT INTO revoked_sessions" in s for s in revocaciones.sql)
    r = client.post("/api/notify", headers=_bearer(t))
    assert r.status_code == 401
    assert client.post("/api/auth/logout", headers=_bearer(t)).status_code == 401   # ya no vale


def test_logout_no_afecta_a_otras_sesiones(client, revocaciones):
    t1, t2 = auth.create_jwt("a@b.com"), auth.create_jwt("a@b.com")
    client.post("/api/auth/logout", headers=_bearer(t1))
    assert client.post("/api/notify", headers=_bearer(t2)).status_code == 200


def test_logout_sin_token_401(client):
    assert client.post("/api/auth/logout").status_code == 401


def test_logout_token_antiguo_sin_jti_200_no_revocable(client, revocaciones):
    t = jwt.encode({"sub": "a@b.com", "exp": datetime.now(timezone.utc) + timedelta(days=1)},
                   auth.JWT_SECRET, algorithm="HS256")
    r = client.post("/api/auth/logout", headers=_bearer(t))
    assert r.status_code == 200 and r.json()["revoked"] is False
    assert client.post("/api/notify", headers=_bearer(t)).status_code == 200   # sigue válido hasta caducar


def test_jti_revocado_da_401_en_endpoint(client):
    t = auth.create_jwt("a@b.com")
    p = jwt.decode(t, auth.JWT_SECRET, algorithms=["HS256"])
    auth._revoked[p["jti"]] = p["exp"]
    try:
        assert client.post("/api/notify", headers=_bearer(t)).status_code == 401
    finally:
        auth._revoked.clear()


@pytest.mark.parametrize("claims", [
    {"exp": "futuro"},                                  # sin sub
    {"sub": "a@b.com"},                                 # sin exp
    {"sub": 5, "exp": "futuro"},                        # sub no es texto
    {"sub": "a@b.com", "exp": "futuro", "jti": 123},    # jti no es texto
])
def test_claims_incorrectos_401_nunca_500(client, claims):
    claims = {k: (datetime.now(timezone.utc) + timedelta(days=1) if v == "futuro" else v)
              for k, v in claims.items()}
    t = jwt.encode(claims, auth.JWT_SECRET, algorithm="HS256")
    assert client.post("/api/notify", headers=_bearer(t)).status_code == 401


def test_token_basura_y_firma_ajena_401(client):
    assert client.post("/api/notify", headers=_bearer("a.b.c")).status_code == 401
    t = jwt.encode({"sub": "a@b.com", "exp": datetime.now(timezone.utc) + timedelta(days=1)},
                   "otra-clave-distinta-de-32-bytes-ok!!", algorithm="HS256")
    assert client.post("/api/notify", headers=_bearer(t)).status_code == 401


def test_purga_de_revocaciones_caducadas():
    auth._revoked.update({"viejo": 1.0, "vigente": 9e12})
    try:
        auth._purge_revoked()
        assert "viejo" not in auth._revoked and "vigente" in auth._revoked
    finally:
        auth._revoked.clear()


def test_lifespan_crea_tabla_de_revocadas():
    import inspect
    import main
    assert "ensure_revoked_sessions_table" in inspect.getsource(main.lifespan)
    assert "CREATE TABLE IF NOT EXISTS revoked_sessions" in inspect.getsource(auth.ensure_revoked_sessions_table)
    schema = open(__file__.replace("tests/test_seguridad_bloque_a.py", "schema.sql"), encoding="utf-8").read()
    assert "CREATE TABLE IF NOT EXISTS revoked_sessions" in schema
    assert "jti TEXT PRIMARY KEY" in schema and "exp TIMESTAMPTZ NOT NULL" in schema

