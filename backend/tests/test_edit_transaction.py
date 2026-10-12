"""PATCH /api/transactions/{id}: edición parcial de un movimiento. BD simulada
con un cursor falso que emula el UPDATE ... WHERE id AND user_email RETURNING."""
from datetime import date

import pytest

from services import crypto
from services import sheets as sheets_mod

OWNER = "test@example.com"  # coincide con auth_headers de conftest


class FakeTxCursor:
    """Tabla en memoria. Interpreta el UPDATE que genera update_transaction."""

    def __init__(self, rows):
        self.rows = rows  # id -> dict con columnas de transactions
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, list(params or [])))
        assert sql.lstrip().startswith("UPDATE transactions SET")
        assert "WHERE id = %s AND user_email = %s" in sql
        set_part = sql.split("SET", 1)[1].split("WHERE", 1)[0]
        cols = [c.split("=")[0].strip() for c in set_part.split(",")]
        *vals, tx_id, email = params
        row = self.rows.get(tx_id)
        self._last = None
        if row is None or row["user_email"] != email:
            return
        for col, val in zip(cols, vals):
            row[col] = val
        self._last = {k: row[k] for k in
                      ("id", "fecha", "tipo", "concepto_enc", "importe_enc", "comentario")}

    def fetchone(self):
        return self._last


@pytest.fixture
def db(monkeypatch):
    rows = {
        7: {"id": 7, "user_email": OWNER, "fecha": "2026-05-06", "tipo": "Gasto Variable",
            "concepto_enc": crypto.encrypt_str("Comida"), "importe_enc": crypto.encrypt_float(32.4),
            "comentario": "cena"},
        8: {"id": 8, "user_email": "otro@example.com", "fecha": "2026-05-06", "tipo": "Ingreso",
            "concepto_enc": crypto.encrypt_str("Nómina"), "importe_enc": crypto.encrypt_float(3200.0),
            "comentario": None},
    }
    cur = FakeTxCursor(rows)

    class _Ctx:
        def __enter__(self):
            return cur

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(sheets_mod, "db_cursor", lambda: _Ctx())
    return cur


@pytest.fixture
def broadcasts(monkeypatch):
    import main
    calls = []

    async def fake():
        calls.append(1)
    monkeypatch.setattr(main, "_broadcast", fake)
    return calls


def _patch(client, headers, body, tx_id=7):
    return client.patch(f"/api/transactions/{tx_id}", headers=headers, json=body)


# ── Casos correctos ──────────────────────────────────────────────────────────

def test_edicion_parcial_solo_fecha(client, auth_headers, db, broadcasts):
    r = _patch(client, auth_headers, {"fecha": "2026-04-30"})
    assert r.status_code == 200
    assert r.json() == {"id": 7, "fecha": "2026-04-30", "tipo": "Gasto Variable",
                        "concepto": "Comida", "importe": 32.4, "comentario": "cena"}
    sql, params = db.executed[0]
    set_part = sql.split("WHERE", 1)[0]
    assert "fecha = %s::date" in set_part
    assert "concepto_enc" not in set_part and "importe_enc" not in set_part
    assert broadcasts == [1]


def test_edicion_todos_los_campos(client, auth_headers, db, broadcasts):
    body = {"fecha": "2026-06-01", "importe": 45, "tipo": "Gasto Fijo",
            "concepto": "  Gimnasio  ", "comentario": "  cuota  "}
    r = _patch(client, auth_headers, body)
    assert r.status_code == 200
    assert r.json() == {"id": 7, "fecha": "2026-06-01", "tipo": "Gasto Fijo",
                        "concepto": "Gimnasio", "importe": 45.0, "comentario": "cuota"}


def test_se_cifra_al_guardar(client, auth_headers, db, broadcasts):
    r = _patch(client, auth_headers, {"concepto": "Supermercado", "importe": 12.5})
    assert r.status_code == 200
    sql, params = db.executed[0]
    # Ni el concepto ni el importe viajan en claro a la BD.
    assert "Supermercado" not in params and 12.5 not in params
    assert all(isinstance(p, bytes) for p in params[:2])
    row = db.rows[7]
    assert crypto.decrypt_str(row["concepto_enc"]) == "Supermercado"
    assert crypto.decrypt_float(row["importe_enc"]) == 12.5
    assert r.json()["concepto"] == "Supermercado" and r.json()["importe"] == 12.5


def test_comentario_vacio_borra(client, auth_headers, db, broadcasts):
    r = _patch(client, auth_headers, {"comentario": ""})
    assert r.status_code == 200 and r.json()["comentario"] == ""
    assert db.rows[7]["comentario"] is None


def test_solo_importe_conserva_concepto(client, auth_headers, db, broadcasts):
    r = _patch(client, auth_headers, {"importe": 1_000_000})
    assert r.status_code == 200
    assert r.json()["concepto"] == "Comida" and r.json()["importe"] == 1_000_000.0


def test_claves_desconocidas_se_ignoran(client, auth_headers, db, broadcasts):
    r = _patch(client, auth_headers, {"tipo": "Ingreso", "source": "app", "id": 99})
    assert r.status_code == 200 and r.json()["id"] == 7 and r.json()["tipo"] == "Ingreso"


# ── 401 / 404 ────────────────────────────────────────────────────────────────

def test_sin_sesion_401(client, db, broadcasts):
    r = client.patch("/api/transactions/7", json={"concepto": "X"})
    assert r.status_code == 401
    assert db.executed == [] and broadcasts == []


def test_token_invalido_401(client, db):
    r = client.patch("/api/transactions/7", json={"concepto": "X"},
                     headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_de_otro_usuario_404(client, auth_headers, db, broadcasts):
    antes = dict(db.rows[8])
    r = _patch(client, auth_headers, {"concepto": "Hack"}, tx_id=8)
    assert r.status_code == 404
    assert db.rows[8] == antes and broadcasts == []
    # Filtrado por usuario en el propio UPDATE
    sql, params = db.executed[0]
    assert params[-2:] == [8, OWNER]


def test_inexistente_404_mismo_mensaje(client, auth_headers, db, broadcasts):
    a = _patch(client, auth_headers, {"concepto": "X"}, tx_id=999)
    b = _patch(client, auth_headers, {"concepto": "X"}, tx_id=8)
    assert a.status_code == b.status_code == 404
    assert a.json() == b.json()


# ── 422 ──────────────────────────────────────────────────────────────────────

ANIO_MAX = date.today().year + 1

INVALIDOS = [
    {},
    {"otra": 1},
    {"fecha": "2026/05/01"},
    {"fecha": "2026-02-30"},
    {"fecha": "1999-12-31"},
    {"fecha": f"{ANIO_MAX + 1}-01-01"},
    {"fecha": 20260501},
    {"fecha": None},
    {"importe": 0},
    {"importe": -5},
    {"importe": 1_000_000.01},
    {"importe": 10 ** 400},
    {"importe": "12"},
    {"importe": True},
    {"importe": None},
    {"tipo": "Gasto"},
    {"tipo": "ingreso"},
    {"tipo": None},
    {"concepto": "   "},
    {"concepto": "x" * 61},
    {"concepto": 5},
    {"comentario": "x" * 501},
    {"comentario": 3},
]


@pytest.mark.parametrize("body", INVALIDOS)
def test_validaciones_422(client, auth_headers, db, broadcasts, body):
    r = _patch(client, auth_headers, body)
    assert r.status_code == 422, body
    assert isinstance(r.json()["detail"], str) and r.json()["detail"]
    assert db.executed == [] and broadcasts == []


@pytest.mark.parametrize("raw", ["NaN", "Infinity", "-Infinity"])
def test_importe_no_finito_422(client, auth_headers, db, raw):
    r = client.patch("/api/transactions/7", headers={**auth_headers, "Content-Type": "application/json"},
                     content='{"importe": %s}' % raw)
    assert r.status_code == 422 and db.executed == []


@pytest.mark.parametrize("raw", ["", "no-json", "[1,2]", '"texto"'])
def test_body_no_objeto_422(client, auth_headers, db, raw):
    r = client.patch("/api/transactions/7", headers={**auth_headers, "Content-Type": "application/json"},
                     content=raw)
    assert r.status_code == 422 and db.executed == []


def test_limites_aceptados(client, auth_headers, db, broadcasts):
    ok = _patch(client, auth_headers, {"concepto": "x" * 60, "comentario": "y" * 500,
                                       "fecha": f"{ANIO_MAX}-12-31"})
    assert ok.status_code == 200
    assert _patch(client, auth_headers, {"fecha": "2000-01-01"}).status_code == 200


def test_mensajes_en_espanol(client, auth_headers, db):
    assert "importe" in _patch(client, auth_headers, {"importe": 0}).json()["detail"].lower()
    assert "concepto" in _patch(client, auth_headers, {"concepto": ""}).json()["detail"].lower()


def test_endpoint_comment_sigue_existiendo(client):
    assert client.patch("/api/transactions/7/comment", json={"comentario": "x"}).status_code == 401
