"""seed_qa.py sin secretos fijos y RLS en schema.sql (sin tocar ninguna BD)."""
import os
import re

import pytest

import seed_qa
from services.auth import verify_password

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── seed_qa.py ────────────────────────────────────────────────────────────────

def test_seed_sin_qa_password_error_claro(monkeypatch):
    monkeypatch.delenv("QA_PASSWORD", raising=False)
    with pytest.raises(SystemExit, match="QA_PASSWORD"):
        seed_qa.read_qa_password()


def test_seed_qa_password_corta_error(monkeypatch):
    monkeypatch.setenv("QA_PASSWORD", "x" * 9)
    with pytest.raises(SystemExit, match="10 caracteres"):
        seed_qa.read_qa_password()


def test_seed_main_falla_antes_de_conectar(monkeypatch):
    monkeypatch.delenv("QA_PASSWORD", raising=False)

    def no_connect(*a, **k):
        raise AssertionError("no debe conectarse a la BD sin QA_PASSWORD")
    monkeypatch.setattr(seed_qa.psycopg2, "connect", no_connect)
    with pytest.raises(SystemExit):
        seed_qa.main()


def test_seed_credenciales_hash_y_token_aleatorio(monkeypatch):
    monkeypatch.setenv("QA_PASSWORD", "clave-de-prueba-larga")
    h1, t1 = seed_qa.build_credentials()
    h2, t2 = seed_qa.build_credentials()
    assert verify_password("clave-de-prueba-larga", h1)
    assert not verify_password("otra-clave-cualquiera", h1)
    assert h1 != h2              # salt distinto en cada ejecución
    assert t1 != t2              # token nuevo en cada ejecución
    assert len(t1) >= 43         # token_urlsafe(32)


def test_seed_sin_secretos_en_el_codigo():
    src = open(os.path.join(BACKEND, "seed_qa.py"), encoding="utf-8").read()
    assert not re.search(r"\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}", src), "no debe haber hashes bcrypt fijos"
    assert "QaTest1234" not in src
    assert "BlsAlWmj" not in src


# ── schema.sql: RLS ───────────────────────────────────────────────────────────

def test_schema_rls_en_todas_las_tablas():
    sql = open(os.path.join(BACKEND, "schema.sql"), encoding="utf-8").read()
    tablas = set(re.findall(r"CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)", sql, re.I))
    con_rls = set(re.findall(r"ALTER TABLE\s+(?:public\.)?(\w+)\s+ENABLE ROW LEVEL SECURITY", sql, re.I))
    assert tablas and tablas == con_rls
    # Sin políticas ni FORCE: el backend (owner) sigue accediendo igual
    assert not re.search(r"^\s*CREATE POLICY", sql, re.I | re.M)
    assert not re.search(r"^\s*ALTER TABLE.*FORCE ROW LEVEL SECURITY", sql, re.I | re.M)
    # RLS va después de crear todas las tablas
    ultimo_create = max(m.start() for m in re.finditer(r"CREATE TABLE", sql))
    primer_rls = min(m.start() for m in re.finditer(r"ENABLE ROW LEVEL SECURITY", sql))
    assert primer_rls > ultimo_create
