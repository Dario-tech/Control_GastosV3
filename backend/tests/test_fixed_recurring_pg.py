"""Fijos recurrentes contra un Postgres REAL y LOCAL desechable (PG_TEST_URL)."""
import asyncio
import os
import uuid
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

import pytest
from fastapi import HTTPException

PG_URL = os.environ.get("PG_TEST_URL", "")
pytestmark = pytest.mark.skipif(not PG_URL, reason="define PG_TEST_URL (Postgres local desechable)")
A, B = "a@pg-test.invalid", "b@pg-test.invalid"


def _url(url, schema):
    p = urlparse(url)
    q = dict(parse_qsl(p.query))
    q["options"] = f"-csearch_path={schema}"
    return urlunparse(p._replace(query=urlencode(q)))


@pytest.fixture
def pg(monkeypatch):
    assert urlparse(PG_URL).hostname in ("localhost", "127.0.0.1", "::1")
    import psycopg2
    schema = f"fr_{uuid.uuid4().hex[:10]}"
    admin = psycopg2.connect(PG_URL)
    admin.autocommit = True
    with admin.cursor() as c:
        c.execute(f"CREATE SCHEMA {schema}")
        c.execute(f"CREATE TABLE {schema}.users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '')")
        for e in (A, B):
            c.execute(f"INSERT INTO {schema}.users (email) VALUES (%s)", (e,))
    from services import db, fixed_recurring
    monkeypatch.setenv("DATABASE_URL", _url(PG_URL, schema))
    monkeypatch.setattr(db, "_pool", None)
    fixed_recurring.ensure_fixed_recurring_table()
    fixed_recurring.ensure_fixed_recurring_table()   # idempotente
    try:
        yield db
    finally:
        if db._pool is not None:
            db._pool.closeall()
        with admin.cursor() as c:
            c.execute(f"DROP SCHEMA {schema} CASCADE")
        admin.close()


def run(c):
    return asyncio.run(c)


def test_crud_aislado_por_usuario_y_cifrado(pg):
    from services import fixed_recurring as fr
    r = run(fr.create(A, "Piso", 700, 1, "2026-12", "2027-12"))
    assert r == {"id": r["id"], "concepto": "Piso", "importe": 700.0, "dia": 1, "desde": "2026-12", "hasta": "2027-12"}
    sin_fin = run(fr.create(A, "Wifi", 30, 15, "2026-12", None))
    assert sin_fin["hasta"] is None
    assert run(fr.list_for_user(B)) == []                       # B no ve lo de A
    for f in (lambda: fr.update(B, r["id"], "X", 1, 1, "2026-12", None), lambda: fr.delete(B, r["id"])):
        with pytest.raises(HTTPException) as e:
            run(f())
        assert e.value.status_code == 404
    assert [x["concepto"] for x in run(fr.list_for_user(A))] == ["Piso", "Wifi"]   # intacto
    up = run(fr.update(A, r["id"], "Piso", 720, 1, "2026-12", "2028-06"))
    assert up["importe"] == 720.0 and up["hasta"] == "2028-06"
    run(fr.delete(A, r["id"]))
    assert [x["concepto"] for x in run(fr.list_for_user(A))] == ["Wifi"]
    with pg.db_cursor() as cur:
        cur.execute("SELECT concepto_enc, importe_enc FROM fixed_recurring")
        for row in cur.fetchall():
            assert b"Wifi" not in bytes(row["concepto_enc"])
