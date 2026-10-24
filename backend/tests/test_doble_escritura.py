"""Doble escritura TEMPORAL de concepto/importe en claro (bloqueante B2 de
MIGRACION_QA_A_PROD.md). Se prueban las dos estructuras de `transactions`:

- "nueva" (schema.sql): sin columnas en claro. Escribirlas fallaría ("column
  does not exist"), así que no deben aparecer en el SQL.
- "prod": `concepto TEXT NOT NULL` e `importe NUMERIC(10,2) NOT NULL` sin
  default. Un INSERT sin ellas fallaría por NOT NULL.

BD simulada con un intérprete mínimo del SQL que generan los servicios.
"""
import re
from decimal import Decimal

import pytest

from services import crypto, legacy_plain
from services import pending as pending_mod
from services import sheets as sheets_mod

OWNER = "test@example.com"  # coincide con auth_headers de conftest


class NotNullViolation(Exception):
    pass


class UndefinedColumn(Exception):
    pass


class FakeDB:
    def __init__(self, estructura: str):
        assert estructura in ("nueva", "prod")
        self.estructura = estructura
        self.cols = {"id", "user_email", "fecha", "tipo", "comentario", "concepto_enc", "importe_enc"}
        if estructura == "prod":
            self.cols |= {"concepto", "importe"}
        self.transactions: dict[int, dict] = {}
        self.pending = {50: {"id": 50, "user_email": OWNER, "importe": Decimal("34.50"),
                             "fecha": "2026-07-10", "comercio_hmac": None}}
        self._id = 100
        self.sql: list[str] = []

    def next_id(self):
        self._id += 1
        return self._id

    def check_cols(self, cols):
        for c in cols:
            if c not in self.cols:
                raise UndefinedColumn(c)


class FakeCursor:
    def __init__(self, db: FakeDB):
        self.db = db
        self._res = None

    def execute(self, sql, params=None):
        db = self.db
        q = " ".join(sql.split())
        db.sql.append(q)
        params = list(params or [])
        # Las columnas en claro NUNCA se leen.
        assert not re.search(r"SELECT[^;]*\b(concepto|importe)\b(?!_enc)[^;]*FROM transactions", q), q

        m = re.match(r"INSERT INTO transactions \(([^)]*)\) VALUES \(([^)]*)\) RETURNING", q)
        if m:
            cols = [c.strip() for c in m.group(1).split(",")]
            db.check_cols(cols)
            row = dict(zip(cols, params))
            if db.estructura == "prod":
                for c in ("concepto", "importe"):
                    if row.get(c) is None:
                        raise NotNullViolation(c)
                # NUMERIC(10,2)
                row["importe"] = Decimal(str(row["importe"])).quantize(Decimal("0.01"))
            row.setdefault("fecha", "2026-10-24")
            row["id"] = db.next_id()
            db.transactions[row["id"]] = row
            self._res = {"id": row["id"], "fecha": str(row["fecha"])}
            return

        m = re.match(r"UPDATE transactions SET (.*) WHERE id = %s AND user_email = %s", q)
        if m:
            cols = [c.split("=")[0].strip() for c in m.group(1).split(",")]
            db.check_cols(cols)
            *vals, tx_id, email = params
            row = db.transactions.get(tx_id)
            self._res = None
            if row is None or row["user_email"] != email:
                return
            for c, v in zip(cols, vals):
                row[c] = Decimal(str(v)).quantize(Decimal("0.01")) if c == "importe" else v
            self._res = {k: row.get(k) for k in
                         ("id", "fecha", "tipo", "concepto_enc", "importe_enc", "comentario")}
            return

        if q.startswith("SELECT importe, fecha, comercio_hmac FROM pending_transactions"):
            pid, email = params
            p = db.pending.get(pid)
            self._res = dict(p) if p and p["user_email"] == email else None
            return
        if q.startswith("DELETE FROM pending_transactions"):
            db.pending.pop(params[0], None)
            return
        if q.startswith("SELECT column_name FROM information_schema.columns"):
            self._res = [{"column_name": c} for c in sorted(db.cols & {"concepto", "importe"})]
            return
        raise AssertionError(f"SQL no emulado: {q[:80]}")

    def fetchone(self):
        return self._res

    def fetchall(self):
        return self._res


def _install(monkeypatch, estructura):
    db = FakeDB(estructura)

    class _Ctx:
        def __enter__(self):
            return FakeCursor(db)

        def __exit__(self, *a):
            return False

    for mod in (sheets_mod, pending_mod, legacy_plain):
        monkeypatch.setattr(mod, "db_cursor", lambda: _Ctx())
    monkeypatch.setattr(legacy_plain, "_enabled", False)  # se restaura al acabar
    legacy_plain.detect_plain_columns()  # lo mismo que hace el lifespan
    return db


@pytest.fixture(params=["nueva", "prod"])
def db(request, monkeypatch):
    return _install(monkeypatch, request.param)


@pytest.fixture(autouse=True)
def _no_broadcast(monkeypatch):
    import main

    async def fake():
        return None
    monkeypatch.setattr(main, "_broadcast", fake)


def _assert_coherente(db, row):
    """Lo cifrado descifra a lo esperado y, en PROD, lo en claro coincide."""
    concepto = crypto.decrypt_str(bytes(row["concepto_enc"]))
    importe = crypto.decrypt_float(bytes(row["importe_enc"]))
    if db.estructura == "prod":
        assert row["concepto"] == concepto
        assert row["importe"] == Decimal(str(importe)).quantize(Decimal("0.01"))
    else:
        assert "concepto" not in row and "importe" not in row
        assert not any(re.search(r"\b(concepto|importe)\b(?!_enc)", s.split("RETURNING")[0])
                       for s in db.sql if "transactions" in s and not s.startswith("SELECT"))
    return concepto, importe


# ── detección ────────────────────────────────────────────────────────────────

def test_deteccion_segun_estructura(db):
    assert legacy_plain.enabled() is (db.estructura == "prod")


def test_deteccion_con_una_sola_columna_no_activa(monkeypatch):
    db = _install(monkeypatch, "nueva")
    db.cols.add("concepto")
    assert legacy_plain.detect_plain_columns() is False
    assert legacy_plain.enabled() is False


def test_por_defecto_desactivada_sin_lifespan():
    assert legacy_plain.enabled() is False


# ── alta ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("fecha", [None, "2026-05-06"])
def test_alta(db, client, auth_headers, fecha):
    body = {"importe": 32.4, "tipo": "Gasto Variable", "concepto": "Comida"}
    if fecha:
        body["fecha"] = fecha
    r = client.post("/api/transaction", headers=auth_headers, json=body)
    assert r.status_code == 200, r.text
    row = db.transactions[r.json()["id"]]
    assert row["user_email"] == OWNER
    if fecha:
        assert row["fecha"] == fecha
    assert _assert_coherente(db, row) == ("Comida", 32.4)


def test_alta_prod_sin_doble_escritura_fallaria(monkeypatch, client, auth_headers):
    """Control: con estructura PROD y la doble escritura apagada el alta falla
    (es el 500/502 del bloqueante B2)."""
    _install(monkeypatch, "prod")
    monkeypatch.setattr(legacy_plain, "_enabled", False)
    r = client.post("/api/transaction", headers=auth_headers,
                    json={"importe": 1.0, "tipo": "Gasto Variable", "concepto": "X"})
    assert r.status_code >= 500


# ── edición ──────────────────────────────────────────────────────────────────

def _alta(client, auth_headers):
    r = client.post("/api/transaction", headers=auth_headers,
                    json={"importe": 32.4, "tipo": "Gasto Variable", "concepto": "Comida", "fecha": "2026-05-06"})
    assert r.status_code == 200
    return r.json()["id"]


@pytest.mark.parametrize("cambio,esperado", [
    ({"concepto": "Cena"}, ("Cena", 32.4)),
    ({"importe": 40.25}, ("Comida", 40.25)),
    ({"concepto": "Cena", "importe": 12}, ("Cena", 12.0)),
    ({"comentario": "nota", "fecha": "2026-05-07"}, ("Comida", 32.4)),
])
def test_edicion(db, client, auth_headers, cambio, esperado):
    tx_id = _alta(client, auth_headers)
    r = client.patch(f"/api/transactions/{tx_id}", headers=auth_headers, json=cambio)
    assert r.status_code == 200, r.text
    assert (r.json()["concepto"], r.json()["importe"]) == esperado
    assert _assert_coherente(db, db.transactions[tx_id]) == esperado


def test_edicion_solo_otros_campos_no_toca_columnas_en_claro(db, client, auth_headers):
    tx_id = _alta(client, auth_headers)
    db.sql.clear()
    r = client.patch(f"/api/transactions/{tx_id}", headers=auth_headers, json={"tipo": "Gasto Fijo"})
    assert r.status_code == 200
    upd = [s for s in db.sql if s.startswith("UPDATE transactions")][0]
    set_part = upd.split(" SET ", 1)[1].split(" WHERE ", 1)[0]
    assert set_part == "tipo = %s"


# ── categorizar pendiente ────────────────────────────────────────────────────

def test_categorizar_pendiente(db, client, auth_headers):
    r = client.post("/api/pending/50/categorize", headers=auth_headers,
                    json={"tipo": "Gasto Variable", "concepto": "Supermercado", "comentario": "semana"})
    assert r.status_code == 200, r.text
    row = db.transactions[r.json()["id"]]
    assert row["fecha"] == "2026-07-10" and row["comentario"] == "semana"
    assert _assert_coherente(db, row) == ("Supermercado", 34.5)
    assert 50 not in db.pending
