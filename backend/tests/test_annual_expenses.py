from datetime import date

from services.annual_expenses import _enrich, _next_due_date


def test_vencimiento_este_año():
    assert _next_due_date(6, 15, date(2025, 1, 1)) == date(2025, 6, 15)


def test_vencimiento_hoy_cuenta_como_este_año():
    assert _next_due_date(6, 15, date(2025, 6, 15)) == date(2025, 6, 15)


def test_vencimiento_pasado_salta_al_siguiente_año():
    assert _next_due_date(3, 1, date(2025, 6, 15)) == date(2026, 3, 1)


def test_febrero_31_se_ajusta():
    assert _next_due_date(2, 31, date(2025, 1, 1)) == date(2025, 2, 28)


def test_dia_31_en_mes_de_30_dias():
    assert _next_due_date(4, 31, date(2025, 1, 1)) == date(2025, 4, 28)


def test_29_febrero_en_año_no_bisiesto():
    # mes==2 limita a 28
    assert _next_due_date(2, 29, date(2025, 1, 1)) == date(2025, 2, 28)


def _row(**kw):
    base = dict(id=1, nombre="IBI", importe="300.00", mes=10, dia=1,
                meses_reparto=None, avisar=True, dias_aviso=15)
    base.update(kw)
    return base


def test_enrich_aviso_activo():
    r = _enrich(_row(), today=date(2025, 9, 20))
    assert r["dias_restantes"] == 11
    assert r["aviso_activo"] is True
    assert r["importe"] == 300.0
    assert r["reparto_mensual"] is None and r["meses_reparto"] == []


def test_enrich_aviso_lejano_o_desactivado():
    assert _enrich(_row(), today=date(2025, 1, 1))["aviso_activo"] is False
    assert _enrich(_row(avisar=False), today=date(2025, 9, 25))["aviso_activo"] is False


def test_enrich_reparto():
    r = _enrich(_row(meses_reparto=[6, 3, 1]), today=date(2025, 1, 1))
    assert r["meses_reparto"] == [1, 3, 6]
    assert r["reparto_mensual"] == 100.0


def test_enrich_reparto_redondeo():
    assert _enrich(_row(meses_reparto=[1, 2, 3]), today=date(2025, 1, 1))["reparto_mensual"] == 100.0
    assert _enrich(_row(importe="100", meses_reparto=[1, 2, 3]), today=date(2025, 1, 1))["reparto_mensual"] == 33.33
