"""Fijos que se repiten cada mes: validación, endpoints, aislamiento y cifrado (sin BD real)."""
from contextlib import contextmanager

import pytest
from fastapi import HTTPException

from services import fixed_recurring as fr
from services.crypto import decrypt_float, decrypt_str


def ok(**kw):
    base = dict(concepto="Piso", importe=700, dia=1, desde="2026-12", hasta="2027-12")
    base.update(kw)
    return base


def test_validate_normaliza():
    v = fr.validate("  Piso   centro ", 700.456, 5, "2026-12", "2027-12")
    assert v["concepto"] == "Piso centro" and v["importe"] == 700.46 and v["dia"] == 5
    assert v["desde"].isoformat() == "2026-12-01" and v["hasta"].isoformat() == "2027-12-01"
    assert fr.validate("Piso", 1, 1, "2026-12", None)["hasta"] is None
    assert fr.validate("Piso", 1, 1, "2026-12", "")["hasta"] is None


@pytest.mark.parametrize("kw", [
    dict(concepto=""), dict(concepto="x" * 61), dict(concepto="a\x00b"), dict(concepto=5),
    dict(importe=0), dict(importe=-3), dict(importe="12"), dict(importe=True), dict(importe=2_000_000),
    dict(dia=0), dict(dia=32), dict(dia="1"), dict(dia=True),
    dict(desde="2026-13"), dict(desde="26-12"), dict(desde=None), dict(desde="1999-12"), dict(desde="2999-01"),
    dict(hasta="2026-11"),            # antes del inicio
    dict(hasta="mañana"),
])
def test_validate_rechaza(kw):
    a = ok(**kw)
    with pytest.raises(HTTPException) as e:
        fr.validate(a["concepto"], a["importe"], a["dia"], a["desde"], a["hasta"])
    assert e.value.status_code == 422


RUTAS = [("get", "/api/fixed-recurring"), ("post", "/api/fixed-recurring"),
         ("patch", "/api/fixed-recurring/1"), ("delete", "/api/fixed-recurring/1")]


@pytest.mark.parametrize("metodo,ruta", RUTAS)
def test_exige_login(client, metodo, ruta):
    assert getattr(client, metodo)(ruta).status_code == 401


def test_endpoint_valida_y_no_toca_bd(client, auth_headers):
    assert client.post("/api/fixed-recurring", json=ok(importe=0), headers=auth_headers).status_code == 422
    assert client.post("/api/fixed-recurring", json=ok(hasta="2020-01"), headers=auth_headers).status_code == 422
    assert client.post("/api/fixed-recurring", json={"concepto": "x"}, headers=auth_headers).status_code == 422


class FakeCur:
    def __init__(self, log, rows=None, count=0):
        self.log, self.rows, self.count, self.rowcount = log, rows or [], count, 1

    def execute(self, sql, params=None):
        self.log.append((sql, params))

    def fetchone(self):
        return {"n": self.count, "id": 7}

    def fetchall(self):
        return self.rows


@pytest.fixture
def fake_db(monkeypatch):
    log, state = [], {"count": 0}

    @contextmanager
    def cursor():
        yield FakeCur(log, count=state["count"])
    monkeypatch.setattr(fr, "db_cursor", cursor)

    async def listado(email):
        return [{"id": 7, "concepto": "Piso", "importe": 700.0, "dia": 1, "desde": "2026-12", "hasta": "2027-12"}]
    monkeypatch.setattr(fr, "list_for_user", listado)
    return log, state


def test_crear_cifra_y_filtra_por_usuario(client, auth_headers, fake_db):
    log, _ = fake_db
    r = client.post("/api/fixed-recurring", json=ok(), headers=auth_headers)
    assert r.status_code == 201 and r.json()["id"] == 7
    sql, params = next(x for x in log if "INSERT INTO fixed_recurring" in x[0])
    assert params[0] == "test@example.com"
    assert decrypt_str(params[1]) == "Piso" and decrypt_float(params[2]) == 700.0
    assert b"Piso" not in params[1]


def test_limite_de_reglas(client, auth_headers, fake_db):
    _, state = fake_db
    state["count"] = fr.MAX_RULES
    assert client.post("/api/fixed-recurring", json=ok(), headers=auth_headers).status_code == 422


def test_borrar_y_editar_solo_lo_propio(client, auth_headers, monkeypatch):
    @contextmanager
    def cursor():
        c = FakeCur([])
        c.rowcount = 0          # ninguna fila del usuario con ese id
        yield c
    monkeypatch.setattr(fr, "db_cursor", cursor)
    assert client.delete("/api/fixed-recurring/99", headers=auth_headers).status_code == 404
    assert client.patch("/api/fixed-recurring/99", json=ok(), headers=auth_headers).status_code == 404


def test_schema_con_rls():
    import os, re
    sql = open(os.path.join(os.path.dirname(__file__), "..", "schema.sql"), encoding="utf-8").read()
    assert re.search(r"CREATE TABLE IF NOT EXISTS fixed_recurring\b", sql)
    assert re.search(r"ALTER TABLE public\.fixed_recurring\s+ENABLE ROW LEVEL SECURITY", sql)
    assert "concepto_enc" in sql.split("CREATE TABLE IF NOT EXISTS fixed_recurring")[1].split(");")[0]
