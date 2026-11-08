"""Importación de extractos CSV: validación, duplicados, cifrado y endpoint (sin BD real)."""
from collections import Counter
from contextlib import contextmanager

import pytest

from services import import_csv
from services.crypto import decrypt_float, decrypt_str


def fila(**kw):
    base = {"fecha": "2025-03-04", "concepto": "Mercadona", "importe": "12,30", "tipo": "Gasto Variable"}
    base.update(kw)
    return base


def test_validar_fila_normaliza_importe_con_el_parser_de_pending():
    v = import_csv.validar_fila(fila(importe="1.234,56 €", concepto="  Mercadona   Madrid "))
    assert v == {"fecha": "2025-03-04", "concepto": "Mercadona Madrid", "importe": 1234.56, "tipo": "Gasto Variable"}


@pytest.mark.parametrize("campo,valor", [
    ("importe", "-5,00"), ("importe", "0"), ("importe", "abc"), ("importe", None), ("importe", True),
    ("fecha", "04/03/2025"), ("fecha", ""), ("fecha", None), ("fecha", "1999-01-01"),
    ("concepto", ""), ("concepto", "   "), ("concepto", 5),
    ("tipo", "Otro"), ("tipo", None),
])
def test_validar_fila_rechaza(campo, valor):
    r = import_csv.validar_fila(fila(**{campo: valor}))
    assert "error" in r
    assert str(valor) not in r["error"] or valor in ("", None)  # sin eco del valor


def test_concepto_largo_se_recorta():
    assert len(import_csv.validar_fila(fila(concepto="x" * 200))["concepto"]) == 60


def test_clasificar_duplicados_consumen_existentes():
    existentes = Counter({import_csv.clave_dup("2025-03-04", 12.30, "MERCADONA"): 1})
    out = import_csv.clasificar([fila(), fila(), fila(importe="5,00"), fila(importe="x")], existentes)
    assert [r["estado"] for r in out] == ["duplicada", "nueva", "nueva", "error"]


@pytest.fixture
def fake_db(monkeypatch):
    ejecutadas = []

    class Cur:
        def execute(self, sql, params=None):
            ejecutadas.append((sql, params))

    @contextmanager
    def cursor():
        yield Cur()

    monkeypatch.setattr(import_csv, "db_cursor", cursor)

    async def sin_existentes(email, fechas):
        return Counter()
    monkeypatch.setattr(import_csv, "cargar_existentes", sin_existentes)
    return ejecutadas


def test_endpoint_requiere_login(client):
    assert client.post("/api/transactions/import", json={"filas": [fila()]}).status_code == 401


def test_preview_no_guarda(client, auth_headers, fake_db):
    r = client.post("/api/transactions/import", json={"filas": [fila(), fila(importe="mal")]}, headers=auth_headers)
    assert r.status_code == 200
    assert [x["estado"] for x in r.json()["filas"]] == ["nueva", "error"]
    assert fake_db == []


def test_confirmar_guarda_cifrado(client, auth_headers, fake_db):
    r = client.post("/api/transactions/import", json={"filas": [fila(), fila(importe="mal")], "confirmar": True},
                    headers=auth_headers)
    assert r.json() == {"importadas": 1, "duplicadas": 0, "errores": 1}
    assert len(fake_db) == 1
    sql, params = fake_db[0]
    assert "concepto_enc" in sql and "importe_enc" in sql
    assert params[0] == "test@example.com"
    assert decrypt_str(params[2]) == "Mercadona"
    assert decrypt_float(params[3]) == 12.30
    assert b"Mercadona" not in params[2]


def test_validacion_del_lote(client, auth_headers, fake_db):
    assert client.post("/api/transactions/import", json={"filas": []}, headers=auth_headers).status_code == 422
    assert client.post("/api/transactions/import", json={"x": 1}, headers=auth_headers).status_code == 422
    demasiadas = [fila()] * (import_csv.MAX_FILAS + 1)
    assert client.post("/api/transactions/import", json={"filas": demasiadas}, headers=auth_headers).status_code == 422


def test_rate_limit(client, auth_headers, fake_db):
    codigos = [client.post("/api/transactions/import", json={"filas": [fila()]}, headers=auth_headers).status_code
               for _ in range(21)]
    assert codigos[:20] == [200] * 20 and codigos[20] == 429
