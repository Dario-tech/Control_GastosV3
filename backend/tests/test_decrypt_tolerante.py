"""Descifrado tolerante: una fila indescifrable (otra DB_ENCRYPTION_KEY, blob
corrupto o NULL) se omite con un warning que lleva el id, sin tumbar la respuesta
ni registrar el contenido. BD simulada con un cursor falso."""
import logging
import os

import pytest

from services import crypto
from services import pending as pending_mod
from services import recurring as recurring_mod
from services import sheets as sheets_mod

CONCEPTO_SECRETO = "ConceptoMuySecreto"


class FakeCursor:
    """Devuelve, en orden, una lista de resultados por cada fetchall()."""

    def __init__(self, results):
        self._results = list(results)
        self.queries = []

    def execute(self, sql, params=None):
        self.queries.append(sql)

    def fetchall(self):
        return self._results.pop(0)


def fake_db(monkeypatch, module, results):
    cur = FakeCursor(results)

    class _Ctx:
        def __enter__(self):
            return cur

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(module, "db_cursor", lambda: _Ctx())
    return cur


def _ok_row(id_, fecha, tipo, concepto, importe):
    return {"id": id_, "fecha": fecha, "tipo": tipo, "comentario": None,
            "concepto_enc": crypto.encrypt_str(concepto), "importe_enc": crypto.encrypt_float(importe)}


def _bad_row(id_, fecha="2026-05-02", tipo="Gasto Variable"):
    # Cifrado con OTRA clave: el descifrado da InvalidTag.
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    other = AESGCM(os.urandom(32))
    nonce = os.urandom(12)
    return {"id": id_, "fecha": fecha, "tipo": tipo, "comentario": None,
            "concepto_enc": nonce + other.encrypt(nonce, CONCEPTO_SECRETO.encode(), None),
            "importe_enc": nonce + other.encrypt(nonce, b"12.5", None)}


def _null_row(id_):
    return {"id": id_, "fecha": "2026-05-03", "tipo": "Gasto Variable", "comentario": None,
            "concepto_enc": None, "importe_enc": b"corto"}


@pytest.fixture
def caplog_warn(caplog):
    caplog.set_level(logging.WARNING, logger="uvicorn.error")
    return caplog


def _assert_logged_ids(caplog, ids):
    text = caplog.text
    for i in ids:
        assert f"id={i}" in text
    assert CONCEPTO_SECRETO not in text
    assert os.environ["DB_ENCRYPTION_KEY"] not in text


# ── helper ────────────────────────────────────────────────────────────────────

def test_decrypt_transaction_ok():
    r = _ok_row(1, "2026-05-01", "Ingreso", "Nómina", 3200.5)
    assert crypto.decrypt_transaction(r["concepto_enc"], r["importe_enc"], 1) == ("Nómina", 3200.5)


def test_decrypt_transaction_acepta_memoryview():
    r = _ok_row(1, "2026-05-01", "Ingreso", "Nómina", 10.0)
    assert crypto.decrypt_transaction(memoryview(r["concepto_enc"]), memoryview(r["importe_enc"]), 1) == ("Nómina", 10.0)


@pytest.mark.parametrize("row", [_bad_row(7), _null_row(7)])
def test_decrypt_transaction_fila_mala_devuelve_none(caplog_warn, row):
    assert crypto.decrypt_transaction(row["concepto_enc"], row["importe_enc"], 7) is None
    _assert_logged_ids(caplog_warn, [7])


def test_decrypt_transaction_importe_no_numerico(caplog_warn):
    c = crypto.encrypt_str("Comida")
    i = crypto.encrypt_str(CONCEPTO_SECRETO)  # float() fallará; el valor no debe salir al log
    assert crypto.decrypt_transaction(c, i, 9) is None
    _assert_logged_ids(caplog_warn, [9])


def test_decrypt_transaction_sin_clave_propaga(monkeypatch):
    r = _ok_row(1, "2026-05-01", "Ingreso", "Nómina", 1.0)
    monkeypatch.setattr(crypto, "_key", None)
    monkeypatch.delenv("DB_ENCRYPTION_KEY")
    with pytest.raises(crypto.EncryptionNotConfigured):
        crypto.decrypt_transaction(r["concepto_enc"], r["importe_enc"], 1)


# ── /api/finance ──────────────────────────────────────────────────────────────

def test_finance_omite_filas_indescifrables(monkeypatch, caplog_warn, client, auth_headers):
    rows = [
        _ok_row(1, "2026-05-01", "Ingreso", "Nómina", 3200.0),
        _bad_row(2),
        _ok_row(3, "2026-05-06", "Gasto Variable", "Comida", 32.4),
        _null_row(4),
    ]
    fake_db(monkeypatch, sheets_mod, [[{"y": 2026}], rows])
    r = client.get("/api/finance?year=2026", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert [t["rowIndex"] for t in body["transactions"]] == [1, 3]
    assert body["availableYears"] == [2026]
    assert body["unreadable"] == 2  # contrato: nº de filas omitidas por no descifrarse
    _assert_logged_ids(caplog_warn, [2, 4])


def test_finance_sin_year_cuenta_ilegibles_de_todos_los_anos(monkeypatch, caplog_warn, client, auth_headers):
    rows = [
        _ok_row(1, "2025-03-01", "Ingreso", "Nómina", 3000.0),
        _bad_row(2, "2025-04-02"),
        _bad_row(3, "2026-05-02"),
        _ok_row(4, "2026-05-06", "Gasto Variable", "Comida", 32.4),
    ]
    fake_db(monkeypatch, sheets_mod, [[{"y": 2025}, {"y": 2026}], rows])
    r = client.get("/api/finance", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["unreadable"] == 2
    assert [t["rowIndex"] for t in body["transactions"]] == [1, 4]
    assert CONCEPTO_SECRETO not in r.text


def test_finance_sin_transacciones_unreadable_cero(monkeypatch, client, auth_headers):
    fake_db(monkeypatch, sheets_mod, [[], []])
    r = client.get("/api/finance", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["configured"] is False
    assert r.json()["unreadable"] == 0


def test_finance_todo_ok_sin_warnings(monkeypatch, caplog_warn, client, auth_headers):
    rows = [_ok_row(1, "2026-05-01", "Ingreso", "Nómina", 3200.0),
            _ok_row(2, "2026-05-06", "Gasto Variable", "Comida", 32.4)]
    fake_db(monkeypatch, sheets_mod, [[{"y": 2026}], rows])
    r = client.get("/api/finance?year=2026", headers=auth_headers)
    assert r.status_code == 200
    assert [(t["concepto"], t["importe"]) for t in r.json()["transactions"]] == [("Nómina", 3200.0), ("Comida", 32.4)]
    assert r.json()["unreadable"] == 0
    assert "No se pudo descifrar" not in caplog_warn.text


# ── /api/pending ──────────────────────────────────────────────────────────────

def test_pending_omite_filas_indescifrables(monkeypatch, caplog_warn, client, auth_headers):
    pend = [{"id": 50, "importe": 34.5, "fecha": "2026-07-10"}]
    history = [
        _ok_row(1, "2026-05-06", "Gasto Variable", "Comida", 34.0),
        _bad_row(2),
        _ok_row(3, "2026-06-06", "Gasto Variable", "Comida", 35.0),
    ]
    cur = fake_db(monkeypatch, pending_mod, [pend, history])
    r = client.get("/api/pending", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1 and body[0]["id"] == 50
    assert "suggested" in body[0]
    assert "SELECT id," in cur.queries[1]  # el id se pide para poder registrarlo
    _assert_logged_ids(caplog_warn, [2])


# ── /api/recurring ────────────────────────────────────────────────────────────

def test_recurring_omite_filas_indescifrables(monkeypatch, caplog_warn, client, auth_headers):
    rows = [
        _ok_row(1, "2026-05-03", "Gasto Fijo", "Netflix", 12.99),
        _bad_row(2, "2026-06-03"),
        _ok_row(3, "2026-06-03", "Gasto Fijo", "Netflix", 12.99),
        _ok_row(4, "2026-07-03", "Gasto Fijo", "Netflix", 12.99),
    ]
    rows = [{k: v for k, v in r.items() if k in ("id", "concepto_enc", "importe_enc", "fecha")} for r in rows]
    cur = fake_db(monkeypatch, recurring_mod, [rows])
    r = client.get("/api/recurring", headers=auth_headers)
    assert r.status_code == 200
    assert any(x["concepto"] == "Netflix" for x in r.json())
    assert "SELECT id," in cur.queries[0]
    _assert_logged_ids(caplog_warn, [2])


# ── /api/transactions/search ─────────────────────────────────────────────────

def test_search_omite_filas_indescifrables(monkeypatch, caplog_warn, client, auth_headers):
    rows = [
        _ok_row(3, "2026-07-03", "Gasto Fijo", "Netflix", 12.99),
        _bad_row(2, "2026-06-03"),
        _ok_row(1, "2026-05-03", "Gasto Fijo", "Netflix", 12.99),
    ]
    fake_db(monkeypatch, sheets_mod, [rows, []])  # 2ª tanda vacía = fin
    r = client.get("/api/transactions/search?q=netflix", headers=auth_headers)
    assert r.status_code == 200
    assert [x["rowIndex"] for x in r.json()["results"]] == [3, 1]
    assert r.json()["unreadable"] == 1
    _assert_logged_ids(caplog_warn, [2])


def test_search_sin_ilegibles_unreadable_cero(monkeypatch, client, auth_headers):
    rows = [_ok_row(1, "2026-05-03", "Gasto Fijo", "Netflix", 12.99)]
    fake_db(monkeypatch, sheets_mod, [rows])
    r = client.get("/api/transactions/search", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["unreadable"] == 0 and r.json()["next_cursor"] is None
