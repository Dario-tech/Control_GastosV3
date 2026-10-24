"""Doble escritura TEMPORAL de concepto/importe en claro (bloqueante B2 de
MIGRACION_QA_A_PROD.md). Se prueban las dos estructuras de `transactions`:

- "nueva" (schema.sql): sin columnas en claro. Escribirlas fallaría ("column
  does not exist"), así que no deben aparecer en el SQL.
- "prod": `concepto TEXT NOT NULL` e `importe NUMERIC(10,2) NOT NULL` sin
  default. Un INSERT sin ellas fallaría por NOT NULL.

BD simulada con un intérprete mínimo del SQL que generan los servicios.
"""
import re
from decimal import Decimal, ROUND_HALF_UP

import pytest

from services import crypto, legacy_plain
from services import pending as pending_mod
from services import sheets as sheets_mod

OWNER = "test@example.com"  # coincide con auth_headers de conftest


class NotNullViolation(Exception):
    pass


class UndefinedColumn(Exception):
    pass


class NumericOverflow(Exception):
    pass


def _numeric_10_2(v) -> Decimal:
    """Lo que hace Postgres al guardar en NUMERIC(10,2): redondeo a céntimos
    (mitades hacia arriba en positivos) y error si |v| ≥ 10^8."""
    d = Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if abs(d) >= Decimal(10) ** 8:
        raise NumericOverflow("numeric field overflow")
    return d


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
                row["importe"] = _numeric_10_2(row["importe"])
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
                row[c] = _numeric_10_2(v) if c == "importe" else v
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
        # Igualdad EXACTA (sin redondear lo descifrado): es lo que compara
        # migrate_encrypt_existing.py; si lo cifrado tuviera más de 2 decimales
        # que Postgres redondea en la columna en claro, aquí fallaría.
        assert Decimal(repr(importe)) == row["importe"]
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


# ── tope del importe (≥ 1e8 desbordaba NUMERIC(10,2) en PROD → 502) ─────────

_MSG_TOPE = "El importe debe ser mayor que 0 y no superar 1.000.000"


@pytest.mark.parametrize("importe", [
    100_000_000, 1e8, 123456789.12, 1_000_000.01, 1_000_000.005, 10**30, 1e300,
    0, -5, 0.004, True,
])
def test_alta_importe_fuera_de_rango_422(db, client, auth_headers, importe):
    r = client.post("/api/transaction", headers=auth_headers,
                    json={"importe": importe, "tipo": "Gasto Variable", "concepto": "Comida"})
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == _MSG_TOPE  # genérico, sin eco del valor
    assert db.transactions == {}


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity", '"nan"', '"inf"'])
def test_alta_importe_no_finito_422(db, client, auth_headers, literal):
    body = '{"importe": %s, "tipo": "Gasto Variable", "concepto": "Comida"}' % literal
    r = client.post("/api/transaction", headers={**auth_headers, "Content-Type": "application/json"},
                    content=body)
    assert r.status_code == 422, r.text
    assert db.transactions == {}


@pytest.mark.parametrize("importe,esperado", [(1_000_000, 1_000_000.0), ("12.5", 12.5), (0.005, 0.01)])
def test_alta_importe_en_el_limite_ok(db, client, auth_headers, importe, esperado):
    r = client.post("/api/transaction", headers=auth_headers,
                    json={"importe": importe, "tipo": "Gasto Variable", "concepto": "Comida"})
    assert r.status_code == 200, r.text
    assert _assert_coherente(db, db.transactions[r.json()["id"]]) == ("Comida", esperado)


def test_alta_prod_sin_tope_desbordaria(monkeypatch):
    """Control: el fake reproduce el desbordamiento de NUMERIC(10,2) de PROD."""
    with pytest.raises(NumericOverflow):
        _numeric_10_2(100_000_000)
    assert _numeric_10_2(1_000_000) == Decimal("1000000.00")


def test_edicion_importe_por_encima_del_tope_422(db, client, auth_headers):
    tx_id = _alta(client, auth_headers)
    r = client.patch(f"/api/transactions/{tx_id}", headers=auth_headers, json={"importe": 100_000_000})
    assert r.status_code == 422
    assert _assert_coherente(db, db.transactions[tx_id]) == ("Comida", 32.4)


def test_categorizar_pendiente_por_encima_del_tope_422(db, client, auth_headers):
    """Un pendiente antiguo (NUMERIC(12,2), anterior al tope) no se mueve a
    transactions: 422 y el pendiente se conserva."""
    db.pending[51] = {"id": 51, "user_email": OWNER, "importe": Decimal("150000000.00"),
                      "fecha": "2026-07-10", "comercio_hmac": None}
    r = client.post("/api/pending/51/categorize", headers=auth_headers,
                    json={"tipo": "Gasto Variable", "concepto": "Supermercado"})
    assert r.status_code == 422
    assert r.json()["detail"] == _MSG_TOPE
    assert db.transactions == {} and 51 in db.pending


# ── redondeo a céntimos ANTES de cifrar (cifrado == claro, siempre) ─────────

# 2.675 y 1.005 son los casos clásicos en que round(float, 2) redondea hacia
# abajo por la representación binaria; Postgres (y nosotros) hacia arriba.
_REDONDEOS = [(0.125, 0.13), (2.675, 2.68), (1.005, 1.01), (10.004, 10.0),
              (12.3456, 12.35), (999_999.994, 999_999.99), (999_999.995, 1_000_000.0)]


@pytest.mark.parametrize("importe,esperado", _REDONDEOS)
def test_alta_redondea_antes_de_cifrar(db, client, auth_headers, importe, esperado):
    r = client.post("/api/transaction", headers=auth_headers,
                    json={"importe": importe, "tipo": "Gasto Variable", "concepto": "Comida"})
    assert r.status_code == 200, r.text
    row = db.transactions[r.json()["id"]]
    assert _assert_coherente(db, row) == ("Comida", esperado)
    assert crypto.decrypt_str(bytes(row["importe_enc"])) == repr(esperado)


@pytest.mark.parametrize("importe,esperado", _REDONDEOS)
def test_edicion_redondea_antes_de_cifrar(db, client, auth_headers, importe, esperado):
    tx_id = _alta(client, auth_headers)
    r = client.patch(f"/api/transactions/{tx_id}", headers=auth_headers, json={"importe": importe})
    assert r.status_code == 200, r.text
    assert r.json()["importe"] == esperado
    assert _assert_coherente(db, db.transactions[tx_id]) == ("Comida", esperado)


def test_servicio_redondea_aunque_no_pase_por_main(db):
    """post_transaction/update_transaction redondean por sí mismos (defensa)."""
    import asyncio
    r = asyncio.run(sheets_mod.post_transaction(2.675, "Gasto Variable", "X", OWNER))
    assert _assert_coherente(db, db.transactions[r["id"]]) == ("X", 2.68)
    asyncio.run(sheets_mod.update_transaction(r["id"], OWNER, {"importe": 0.125}))
    assert _assert_coherente(db, db.transactions[r["id"]]) == ("X", 0.13)


def test_sin_redondeo_migrate_marcaria_discrepancia():
    """Control: cifrar 0.125 tal cual y guardar en NUMERIC(10,2) (0.13) difiere
    más de 0.001, que es lo que migrate_encrypt_existing.py marca como error."""
    assert abs(0.125 - float(_numeric_10_2(0.125))) > 0.001
