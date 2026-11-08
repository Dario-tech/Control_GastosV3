"""Gastos compartidos integrados: validación de endpoints, aislamiento por usuario y esquema (sin BD real)."""
import os
import re

import pytest

RUTAS = [
    ("get", "/api/shared"), ("post", "/api/shared/people"), ("delete", "/api/shared/people/1"),
    ("post", "/api/shared/expenses"), ("delete", "/api/shared/expenses/1"),
    ("post", "/api/shared/settlements"), ("delete", "/api/shared/settlements/1"),
]


@pytest.mark.parametrize("metodo,ruta", RUTAS)
def test_todas_las_rutas_exigen_login(client, metodo, ruta):
    assert getattr(client, metodo)(ruta).status_code == 401


def test_ya_no_existen_las_rutas_de_grupos(client, auth_headers):
    assert client.get("/api/groups", headers=auth_headers).status_code == 404
    assert client.get("/api/users/directory", headers=auth_headers).status_code == 404


def test_persona_valida_nombre(client, auth_headers):
    for nombre in ("   ", "x" * 61, "mal\x00"):
        assert client.post("/api/shared/people", json={"nombre": nombre}, headers=auth_headers).status_code == 422


BASE = {"importe": 60, "tipo": "Gasto Variable", "concepto": "Cena", "reparto": {"modo": "igual"}}


@pytest.mark.parametrize("cambio", [
    {"importe": 0}, {"importe": -5}, {"importe": "10"}, {"importe": True}, {"importe": 2_000_000},
    {"tipo": "Otro"}, {"concepto": "   "}, {"fecha": "ayer"}, {"id_cliente": "!!"},
    {"reparto": "igual"},
])
def test_gasto_compartido_valida_entrada(client, auth_headers, cambio):
    r = client.post("/api/shared/expenses", json={**BASE, **cambio}, headers=auth_headers)
    assert r.status_code == 422
    assert "2000000" not in r.text and "Cena" not in r.text  # sin eco de lo recibido


def test_liquidacion_valida_entrada(client, auth_headers):
    h = auth_headers
    assert client.post("/api/shared/settlements", json={"persona_id": 1, "direccion": "x", "importe": 5}, headers=h).status_code == 422
    assert client.post("/api/shared/settlements", json={"persona_id": 1, "direccion": "cobro", "importe": 0}, headers=h).status_code == 422


def test_rate_limit_escrituras(client, auth_headers):
    codigos = [client.post("/api/shared/people", json={"nombre": " "}, headers=auth_headers).status_code
               for _ in range(62)]
    assert 429 in codigos


# ── aislamiento: toda consulta de datos del usuario filtra por user_email ────

def _sql_de(src: str):
    return re.findall(r'"""(.*?)"""|"((?:SELECT|DELETE|INSERT)[^"]*)"', src, re.S)


def test_toda_consulta_de_shared_filtra_por_usuario():
    src = open(os.path.join(os.path.dirname(__file__), "..", "services", "shared.py"), encoding="utf-8").read()
    consultas = [a or b for a, b in _sql_de(src)]
    for q in consultas:
        if not re.search(r"\b(FROM|INTO)\s+(shared_|transactions)", q) or "CREATE" in q:
            continue
        # Las únicas sin user_email son las hijas (shared_shares), siempre por ids ya verificados
        # del propio usuario, y los INSERT (que escriben user_email como columna).
        if re.search(r"(FROM|INTO) shared_shares", q) and "JOIN shared_expenses" not in q:
            continue
        assert "user_email" in q, q


# ── esquema ───────────────────────────────────────────────────────────────────

def test_schema_con_rls_y_columnas_cifradas():
    sql = open(os.path.join(os.path.dirname(__file__), "..", "schema.sql"), encoding="utf-8").read()
    for t in ("shared_people", "shared_expenses", "shared_shares", "shared_settlements"):
        assert re.search(rf"CREATE TABLE IF NOT EXISTS {t}\b", sql), t
        assert re.search(rf"ALTER TABLE public\.{t}\s+ENABLE ROW LEVEL SECURITY", sql), t
    bloque = sql[sql.index("CREATE TABLE IF NOT EXISTS shared_people"):sql.index("idx_shared_settlements_user")]
    assert "total_enc" in bloque and "share_enc" in bloque and "nombre_enc" in bloque and "importe_enc" in bloque
    assert not re.search(r"\b(importe|total|nombre)\s+(NUMERIC|TEXT)", bloque)
    assert "transaction_id INTEGER UNIQUE REFERENCES transactions(id) ON DELETE CASCADE" in bloque
