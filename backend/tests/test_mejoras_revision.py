"""Mejoras de revisión: endpoint de precios eliminado, bcrypt fuera del event loop,
límites de suggest-emoji y del atajo iOS, e idempotencia opcional del alta."""
import asyncio
import threading
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
JSON = {"Content-Type": "application/json"}


# ── Precios eliminados ────────────────────────────────────────────────────────

def test_precios_eliminado(client, auth_headers):
    assert client.get("/api/investments/prices").status_code == 404
    assert not (BACKEND / "services" / "prices.py").exists()
    assert "yfinance" not in (BACKEND / "requirements.txt").read_text()


# ── bcrypt fuera del event loop ───────────────────────────────────────────────

def test_login_y_registro_bcrypt_en_hilo(client, monkeypatch):
    import main
    hilos = []
    principal = threading.get_ident()

    def verify(pw, h):
        hilos.append(threading.get_ident())
        return False

    def hashp(pw):
        hilos.append(threading.get_ident())
        return "hash"

    async def no_hash(_):
        return None

    async def create(email, name, pw_hash):
        return {"name": name, "shortcut_token": "tok"}
    monkeypatch.setattr(main, "verify_password", verify)
    monkeypatch.setattr(main, "hash_password", hashp)
    monkeypatch.setattr(main, "get_password_hash", no_hash)
    monkeypatch.setattr(main, "create_user_with_password", create)

    assert client.post("/api/auth/login-email", json={"email": "a@b.com", "password": "x"}).status_code == 401
    assert client.post("/api/auth/register",
                       json={"email": "a@b.com", "name": "A", "password": "1234567890"}).status_code == 200
    assert len(hilos) == 2 and all(h != principal for h in hilos)
    # el hilo del bcrypt de relleno no es el del test (el loop de TestClient corre en otro hilo)


# ── suggest-emoji ─────────────────────────────────────────────────────────────

def test_suggest_emoji_nombre_largo_422(client, auth_headers):
    r = client.post("/api/categorize/suggest-emoji", headers=auth_headers, json={"nombre": "x" * 61})
    assert r.status_code == 422


def test_suggest_emoji_limite_por_usuario(client, auth_headers):
    body = {"nombre": "Farmacia"}
    for _ in range(20):
        r = client.post("/api/categorize/suggest-emoji", headers=auth_headers, json=body)
        assert r.status_code == 200 and r.json() == {"emoji": "💶"}  # sin API key: emoji por defecto
    assert client.post("/api/categorize/suggest-emoji", headers=auth_headers, json=body).status_code == 429
    # nombre de 60 caracteres: válido
    from services.auth import create_jwt
    otro = {"Authorization": f"Bearer {create_jwt('otro@example.com')}"}
    assert client.post("/api/categorize/suggest-emoji", headers=otro, json={"nombre": "x" * 60}).status_code == 200


# ── /api/shortcut/pending: límite por IP antes de la BD ───────────────────────

def test_shortcut_limite_por_ip_antes_de_bd(client, monkeypatch):
    import main
    consultas = []

    async def email_by_token(token):
        consultas.append(token)
        return None
    monkeypatch.setattr(main, "get_email_by_shortcut_token", email_by_token)
    # tokens distintos cada vez: el límite por token no salta, el de IP sí
    for i in range(60):
        assert client.post("/api/shortcut/pending", json={"token": f"t{i}", "importe": 5}).status_code == 401
    r = client.post("/api/shortcut/pending", json={"token": "t-nuevo", "importe": 5})
    assert r.status_code == 429
    assert "t-nuevo" not in consultas and len(consultas) == 60


# ── /api/shortcut/pending: id_externo opcional ────────────────────────────────

@pytest.fixture
def shortcut_dedup(monkeypatch):
    import main
    llamadas = {"plain": 0, "dedup": []}

    async def email_by_token(token):
        return "user@example.com"

    async def plain(email, importe, fecha=None, fuente=None):
        llamadas["plain"] += 1
        return {"id": 1, "importe": importe}

    async def dedup(email, importe, fecha, comercio, id_externo, fuente="manual"):
        llamadas["dedup"].append((importe, comercio, id_externo, fuente))
        return {"id": 9, "importe": importe, "fecha": fecha, "comercio": None,
                "duplicada": len(llamadas["dedup"]) > 1, "sugerencia": None}
    monkeypatch.setattr(main, "get_email_by_shortcut_token", email_by_token)
    monkeypatch.setattr(main, "create_pending", plain)
    monkeypatch.setattr(main, "create_pending_dedup", dedup)
    return llamadas


def test_shortcut_sin_id_externo_igual_que_antes(client, shortcut_dedup):
    r = client.post("/api/shortcut/pending", json={"token": "t", "importe": 5})
    assert r.status_code == 200 and r.json() == {"id": 1, "importe": 5.0}
    assert shortcut_dedup["plain"] == 1 and shortcut_dedup["dedup"] == []


def test_shortcut_con_id_externo_dedup(client, shortcut_dedup):
    body = {"token": "t", "importe": 5, "id_externo": "abc-123"}
    a = client.post("/api/shortcut/pending", json=body).json()
    b = client.post("/api/shortcut/pending", json=body).json()
    assert a["duplicada"] is False and b["duplicada"] is True and a["id"] == b["id"]
    assert shortcut_dedup["dedup"][0] == (5.0, None, "abc-123", "atajo")


@pytest.mark.parametrize("valor", ["", "  ", 5, "x" * 129, ["a"]])
def test_shortcut_id_externo_invalido_422(client, shortcut_dedup, valor):
    r = client.post("/api/shortcut/pending", json={"token": "t", "importe": 5, "id_externo": valor})
    assert r.status_code == 422
    assert shortcut_dedup["plain"] == 0 and shortcut_dedup["dedup"] == []


# ── POST /api/transaction: id_cliente ─────────────────────────────────────────

@pytest.fixture
def post_tx(monkeypatch):
    import main
    visto = []

    async def fake(importe, tipo, concepto, email, source, fecha, comentario, id_cliente=None):
        visto.append(id_cliente)
        return {"status": "ok", "id": 1, "fecha": "2026-01-01"}

    async def bc():
        pass
    monkeypatch.setattr(main, "post_transaction", fake)
    monkeypatch.setattr(main, "_broadcast", bc)
    return visto


def _alta(client, headers, extra=""):
    return client.post("/api/transaction", headers={**headers, **JSON},
                       content='{"importe": 5, "tipo": "Gasto Variable", "concepto": "X"%s}' % extra)


def test_transaction_sin_id_cliente_igual(client, auth_headers, post_tx):
    assert _alta(client, auth_headers).status_code == 200
    assert post_tx == [None]


def test_transaction_id_cliente_se_propaga(client, auth_headers, post_tx):
    r = _alta(client, auth_headers, ', "id_cliente": "7c9e6679-7425-40de-944b-e07fc1f90ae7"')
    assert r.status_code == 200 and post_tx == ["7c9e6679-7425-40de-944b-e07fc1f90ae7"]


@pytest.mark.parametrize("raw", ['""', '"corto"', '"x y z w 1234"', '"' + "a" * 65 + '"', "123", "[]"])
def test_transaction_id_cliente_invalido_422(client, auth_headers, post_tx, raw):
    assert _alta(client, auth_headers, ', "id_cliente": %s' % raw).status_code == 422
    assert post_tx == []


# ── post_transaction: SQL de idempotencia (BD simulada) ───────────────────────

class _Cur:
    def __init__(self, insert_row):
        self.sqls, self.insert_row, self._last = [], insert_row, None

    def execute(self, sql, params=None):
        self.sqls.append(sql)
        self._last = sql

    def fetchone(self):
        return self.insert_row if "INSERT" in self._last else {"id": 42, "fecha": "2026-02-02"}


def _run_post(monkeypatch, insert_row, **kw):
    from contextlib import contextmanager
    from services import sheets
    cur = _Cur(insert_row)

    @contextmanager
    def fake_cursor():
        yield cur

    async def inline(fn):
        return fn()
    monkeypatch.setattr(sheets, "db_cursor", fake_cursor)
    monkeypatch.setattr(sheets, "run_in_thread", inline)
    return cur, asyncio.run(sheets.post_transaction(5.0, "Gasto Variable", "X", "u@x.com", **kw))


def test_post_transaction_primer_envio(monkeypatch):
    cur, out = _run_post(monkeypatch, {"id": 7, "fecha": "2026-01-01"}, id_cliente="abcdefgh")
    assert out == {"status": "ok", "id": 7, "fecha": "2026-01-01"}
    assert "ON CONFLICT (user_email, id_cliente)" in cur.sqls[0] and len(cur.sqls) == 1


def test_post_transaction_reintento_devuelve_existente(monkeypatch):
    cur, out = _run_post(monkeypatch, None, id_cliente="abcdefgh")
    assert out == {"status": "ok", "id": 42, "fecha": "2026-02-02", "duplicada": True}
    assert "SELECT" in cur.sqls[1]


def test_post_transaction_sin_id_no_toca_columna(monkeypatch):
    cur, out = _run_post(monkeypatch, {"id": 7, "fecha": "2026-01-01"})
    assert "id_cliente" not in cur.sqls[0] and "duplicada" not in out


def test_migracion_id_cliente_en_schema_y_ensure():
    sql = (BACKEND / "schema.sql").read_text()
    assert "ADD COLUMN IF NOT EXISTS id_cliente" in sql
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_user_id_cliente" in sql
    assert "WHERE id_cliente IS NOT NULL" in sql
    import inspect
    from services import sheets
    src = inspect.getsource(sheets.ensure_id_cliente)
    assert "IF NOT EXISTS" in src and "WHERE id_cliente IS NOT NULL" in src
