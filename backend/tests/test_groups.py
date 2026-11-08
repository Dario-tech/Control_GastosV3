"""Gastos compartidos: lógica de reparto/saldos (pura), validación de endpoints y esquema (sin BD real)."""
import os
import re

import pytest

from services import groups

A, B, C = "a@x.es", "b@x.es", "c@x.es"


# ── reparto ───────────────────────────────────────────────────────────────────

def test_reparto_igual_reparte_el_resto_por_orden_alfabetico():
    assert groups.reparto_igual(1000, [C, A, B]) == {A: 334, B: 333, C: 333}
    assert sum(groups.reparto_igual(1001, [A, B, C]).values()) == 1001
    assert groups.reparto_igual(5, [A]) == {A: 5}


def test_reparto_igual_sin_participantes():
    with pytest.raises(ValueError):
        groups.reparto_igual(100, [])


def test_partes_igual_por_defecto_todos_y_subconjunto():
    assert groups.calcular_partes(900, {"modo": "igual"}, [A, B, C]) == ("igual", {A: 300, B: 300, C: 300})
    assert groups.calcular_partes(900, {"modo": "igual", "participantes": [A, B]}, [A, B, C])[1] == {A: 450, B: 450}


def test_partes_importes_deben_sumar_el_total():
    modo, p = groups.calcular_partes(1000, {"modo": "importes", "partes": {A: 4, B: 6}}, [A, B, C])
    assert modo == "importes" and p == {A: 400, B: 600}
    for malo in ({A: 4, B: 5}, {A: 4, B: 7}, {A: 10, B: 0}, {A: -1, B: 11}, {"x@x.es": 10}):
        with pytest.raises(ValueError):
            groups.calcular_partes(1000, {"modo": "importes", "partes": malo}, [A, B, C])


@pytest.mark.parametrize("reparto", [
    None, "igual", {}, {"modo": "otro"}, {"modo": "igual", "participantes": []},
    {"modo": "igual", "participantes": ["intruso@x.es"]}, {"modo": "igual", "participantes": "a@x.es"},
    {"modo": "importes"}, {"modo": "importes", "partes": {}},
])
def test_partes_invalidas(reparto):
    with pytest.raises(ValueError):
        groups.calcular_partes(1000, reparto, [A, B, C])


def test_errores_de_reparto_no_incluyen_valores():
    with pytest.raises(ValueError) as e:
        groups.calcular_partes(1000, {"modo": "igual", "participantes": ["secreto@x.es"]}, [A, B])
    assert "secreto" not in str(e.value)


# ── saldos ────────────────────────────────────────────────────────────────────

def gasto(pagador, total, partes):
    return {"pagado_por": pagador, "_total": total, "_partes": partes}


def test_saldos_y_deudas():
    # A paga 90 € a partes iguales entre 3; B paga 30 € solo entre A y B
    gastos = [gasto(A, 9000, {A: 3000, B: 3000, C: 3000}), gasto(B, 3000, {A: 1500, B: 1500})]
    net = groups.calcular_saldos([A, B, C], gastos, [])
    assert net == {A: 9000 - 3000 - 1500, B: 3000 - 3000 - 1500, C: -3000}
    assert sum(net.values()) == 0
    deudas = groups.simplificar_deudas(net)
    assert {(d["de"], d["a"], d["importe"]) for d in deudas} == {(B, A, 15.0), (C, A, 30.0)}


def test_un_pago_salda_la_deuda():
    gastos = [gasto(A, 3000, {A: 1500, B: 1500})]
    pagos = [{"de": B, "a": A, "_total": 1500}]
    net = groups.calcular_saldos([A, B], gastos, pagos)
    assert net == {A: 0, B: 0}
    assert groups.simplificar_deudas(net) == []


def test_simplificar_cuadra_siempre():
    net = {A: 700, B: -250, C: -450}
    deudas = groups.simplificar_deudas(net)
    cobrado = sum(int(round(d["importe"] * 100)) for d in deudas)
    assert cobrado == 700 and all(d["a"] == A for d in deudas)


# ── endpoints (validación, sin BD) ────────────────────────────────────────────

RUTAS = [
    ("get", "/api/groups"), ("post", "/api/groups"), ("get", "/api/groups/1"), ("delete", "/api/groups/1"),
    ("post", "/api/groups/1/members"), ("post", "/api/groups/1/guests"), ("delete", "/api/groups/1/guests/1"),
    ("get", "/api/users/directory"), ("post", "/api/groups/1/expenses"),
    ("delete", "/api/groups/1/expenses/1"), ("post", "/api/groups/1/settlements"),
    ("delete", "/api/groups/1/settlements/1"),
]


@pytest.mark.parametrize("metodo,ruta", RUTAS)
def test_todas_las_rutas_exigen_login(client, metodo, ruta):
    assert getattr(client, metodo)(ruta).status_code == 401


def test_validacion_de_entrada(client, auth_headers):
    h = auth_headers
    assert client.post("/api/groups", json={"nombre": "   "}, headers=h).status_code == 422
    assert client.post("/api/groups", json={"nombre": "x" * 61}, headers=h).status_code == 422
    assert client.post("/api/groups", json={"nombre": "mal\x00"}, headers=h).status_code == 422
    bad = {"concepto": "Cena", "reparto": {"modo": "igual"}}
    for imp in (0, -3, "12", True, None, 2_000_000):
        r = client.post("/api/groups/1/expenses", json={**bad, "importe": imp}, headers=h)
        assert r.status_code == 422, imp
    r = client.post("/api/groups/1/expenses", json={"concepto": "Cena", "importe": 10, "fecha": "ayer", "reparto": {"modo": "igual"}}, headers=h)
    assert r.status_code == 422
    assert client.post("/api/groups/1/settlements", json={"de": A, "a": B, "importe": 0}, headers=h).status_code == 422


def test_rate_limit_invitaciones(client, auth_headers, monkeypatch):
    async def fake(gid, email, inv):
        return {"id": gid}
    monkeypatch.setattr(groups, "invite", fake)
    codigos = [client.post("/api/groups/1/members", json={"email": "z@x.es"}, headers=auth_headers).status_code
               for _ in range(31)]
    assert codigos[:30] == [200] * 30 and codigos[30] == 429


def test_invitado_valida_nombre(client, auth_headers):
    assert client.post("/api/groups/1/guests", json={"nombre": "  "}, headers=auth_headers).status_code == 422
    assert client.post("/api/groups/1/guests", json={"nombre": "x" * 61}, headers=auth_headers).status_code == 422


def test_directorio_con_rate_limit(client, auth_headers, monkeypatch):
    async def fake(email):
        return [{"email": "b@x.es", "nombre": "Beto"}]
    monkeypatch.setattr(groups, "list_directory", fake)
    r = client.get("/api/users/directory", headers=auth_headers)
    assert r.status_code == 200 and r.json() == [{"email": "b@x.es", "nombre": "Beto"}]
    codigos = [client.get("/api/users/directory", headers=auth_headers).status_code for _ in range(30)]
    assert codigos[-1] == 429


# ── esquema ───────────────────────────────────────────────────────────────────

def test_schema_incluye_las_tablas_nuevas_con_rls():
    sql = open(os.path.join(os.path.dirname(__file__), "..", "schema.sql"), encoding="utf-8").read()
    for t in ("expense_groups", "expense_group_members", "group_guests", "group_expenses", "group_expense_shares", "group_settlements"):
        assert re.search(rf"CREATE TABLE IF NOT EXISTS {t}\b", sql), t
        assert re.search(rf"ALTER TABLE public\.{t}\s+ENABLE ROW LEVEL SECURITY", sql), t
    # importes y textos cifrados: ninguna columna en claro
    assert "importe_enc" in sql and "share_enc" in sql and "concepto_enc" in sql and "nombre_enc" in sql
    assert not re.search(r"group_expenses \([^;]*\bimporte\s+NUMERIC", sql, re.S)
