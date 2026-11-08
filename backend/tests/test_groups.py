"""Reparto y saldos en céntimos (funciones puras de services/groups.py que reutiliza shared.py)."""
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
