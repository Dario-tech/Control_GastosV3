from services.recurring import _parse_date, detect_recurring


def _series(concepto, importe, fechas):
    return [{"concepto": concepto, "importe": importe, "fecha": f} for f in fechas]


def test_parse_date():
    assert _parse_date("2025-03-04T10:00:00").day == 4
    assert _parse_date("basura") is None
    assert _parse_date(None) is None


def test_detecta_mensual():
    h = _series("Netflix", -12.99, ["2025-01-05", "2025-02-05", "2025-03-07", "2025-04-05"])
    r = detect_recurring(h)
    assert len(r) == 1
    assert r[0]["frecuencia"] == "mensual"
    assert r[0]["importe"] == 12.99
    assert r[0]["ocurrencias"] == 4
    assert r[0]["ultima"] == "2025-04-05"
    assert r[0]["proxima"] == "2025-05-05"


def test_detecta_semanal_y_anual():
    sem = _series("Gym", 10, ["2025-01-01", "2025-01-08", "2025-01-15"])
    anu = _series("Seguro", 500, ["2022-03-01", "2023-03-01", "2024-03-01"])
    r = {x["concepto"]: x["frecuencia"] for x in detect_recurring(sem + anu)}
    assert r == {"Gym": "semanal", "Seguro": "anual"}


def test_menos_de_tres_no_cuenta():
    assert detect_recurring(_series("X", 5, ["2025-01-01", "2025-02-01"])) == []


def test_intervalo_irregular_no_cuenta():
    assert detect_recurring(_series("X", 5, ["2025-01-01", "2025-01-20", "2025-04-01"])) == []


def test_importes_distintos_no_se_agrupan():
    h = _series("Compra", 5, ["2025-01-01"]) + _series("Compra", 50, ["2025-02-01"]) + \
        _series("Compra", 500, ["2025-03-01"])
    assert detect_recurring(h) == []


def test_ignora_datos_invalidos():
    h = [{"concepto": "", "importe": 1, "fecha": "2025-01-01"},
         {"concepto": "A", "importe": "x", "fecha": "2025-01-01"},
         {"concepto": "A", "importe": 1, "fecha": "mal"}]
    assert detect_recurring(h) == []


def test_fechas_mismo_dia_no_cuentan():
    assert detect_recurring(_series("A", 5, ["2025-01-01"] * 3)) == []


def test_orden_por_importe_desc():
    a = _series("Barato", 5, ["2025-01-01", "2025-02-01", "2025-03-01"])
    b = _series("Caro", 50, ["2025-01-02", "2025-02-02", "2025-03-02"])
    assert [x["concepto"] for x in detect_recurring(a + b)] == ["Caro", "Barato"]
