from services.suggest import _normalize_tipo, suggest_category


def test_normalize_tipo():
    assert _normalize_tipo("INGRESOS") == "Ingreso"
    assert _normalize_tipo("gasto fijo") == "Gasto Fijo"
    assert _normalize_tipo("Gasto Variable") == "Gasto Variable"
    assert _normalize_tipo(None) == "Gasto Variable"
    assert _normalize_tipo("lo que sea") == "Gasto Variable"


def test_sin_historial():
    assert suggest_category([], 10) is None


def test_historial_sin_concepto_o_importe_invalido():
    h = [{"tipo": "x", "concepto": "  ", "importe": 5}, {"concepto": "A", "importe": "abc"}]
    assert suggest_category(h, 5) is None


def test_prefiere_importe_cercano():
    h = [
        {"tipo": "Gasto Variable", "concepto": "Café", "importe": -2},
        {"tipo": "Gasto Variable", "concepto": "Café", "importe": -2.5},
        {"tipo": "Gasto Fijo", "concepto": "Alquiler", "importe": -800},
        {"tipo": "Gasto Fijo", "concepto": "Alquiler", "importe": -800},
    ]
    assert suggest_category(h, 2.2)["concepto"] == "Café"
    r = suggest_category(h, 800)
    assert (r["tipo"], r["concepto"]) == ("Gasto Fijo", "Alquiler")
    assert 0 <= r["confidence"] <= 1


def test_frecuencia_desempata():
    h = [{"concepto": "A", "importe": 10}] * 5 + [{"concepto": "B", "importe": 10}]
    assert suggest_category(h, 10)["concepto"] == "A"
