"""Doble escritura TEMPORAL (B2) contra un Postgres REAL. Opcional: solo corre
con PG_TEST_URL apuntando a un Postgres LOCAL desechable (ver
tests/test_user_data_pg.py para levantarlo con Docker).

Cada test crea un schema propio y aislado con una tabla `transactions` de una
de estas dos formas, y lo borra al terminar (no toca las tablas de schema.sql):
- "prod": concepto TEXT NOT NULL e importe NUMERIC(10,2) NOT NULL sin default,
  como en PRODUCCIÓN (más las columnas que añade el backend al arrancar).
- "nueva": como schema.sql, sin columnas en claro.
"""
import asyncio
import os
import uuid
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

import pytest

from services import crypto

PG_URL = os.environ.get("PG_TEST_URL", "")

pytestmark = pytest.mark.skipif(not PG_URL, reason="define PG_TEST_URL (Postgres local desechable) para el SQL real")

_PLAIN = "concepto TEXT NOT NULL, importe NUMERIC(10,2) NOT NULL,"


def _ddl(schema: str, estructura: str) -> list[str]:
    return [
        f"CREATE SCHEMA {schema}",
        f"""CREATE TABLE {schema}.transactions (
                id SERIAL PRIMARY KEY, user_email TEXT NOT NULL,
                fecha DATE NOT NULL DEFAULT CURRENT_DATE, tipo TEXT NOT NULL,
                {_PLAIN if estructura == 'prod' else ''}
                created_at TIMESTAMPTZ DEFAULT now(), comentario TEXT,
                concepto_enc BYTEA, importe_enc BYTEA)""",
        f"""CREATE TABLE {schema}.pending_transactions (
                id SERIAL PRIMARY KEY, user_email TEXT NOT NULL,
                importe NUMERIC(10,2) NOT NULL, fecha DATE NOT NULL DEFAULT CURRENT_DATE,
                created_at TIMESTAMPTZ DEFAULT now(), comercio_enc BYTEA, comercio_hmac BYTEA,
                fuente TEXT, id_externo_hmac BYTEA)""",
    ]


def _url_with_search_path(url: str, schema: str) -> str:
    p = urlparse(url)
    q = dict(parse_qsl(p.query))
    q["options"] = f"-csearch_path={schema}"
    return urlunparse(p._replace(query=urlencode(q)))


@pytest.fixture(params=["nueva", "prod"])
def pg(request, monkeypatch):
    host = urlparse(PG_URL).hostname
    assert host in ("localhost", "127.0.0.1", "::1"), "PG_TEST_URL debe ser un Postgres LOCAL"
    import psycopg2
    schema = f"b2_{uuid.uuid4().hex[:10]}"
    admin = psycopg2.connect(PG_URL)
    admin.autocommit = True
    with admin.cursor() as c:
        for stmt in _ddl(schema, request.param):
            c.execute(stmt)

    from services import db, legacy_plain
    monkeypatch.setenv("DATABASE_URL", _url_with_search_path(PG_URL, schema))
    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(legacy_plain, "_enabled", False)
    try:
        yield type("PG", (), {"db": db, "estructura": request.param, "schema": schema})
    finally:
        if db._pool is not None:
            db._pool.closeall()
        with admin.cursor() as c:
            c.execute(f"DROP SCHEMA {schema} CASCADE")
        admin.close()


def _row(pg, tx_id):
    with pg.db.db_cursor() as cur:
        cur.execute("SELECT * FROM transactions WHERE id = %s", (tx_id,))
        return cur.fetchone()


def _check(pg, tx_id, concepto, importe):
    row = _row(pg, tx_id)
    assert crypto.decrypt_str(bytes(row["concepto_enc"])) == concepto
    assert crypto.decrypt_float(bytes(row["importe_enc"])) == importe
    if pg.estructura == "prod":
        assert row["concepto"] == concepto
        assert float(row["importe"]) == importe
    else:
        assert "concepto" not in row and "importe" not in row


def test_alta_edicion_y_categorizar(pg):
    from services import legacy_plain, sheets, pending
    assert legacy_plain.detect_plain_columns() is (pg.estructura == "prod")
    email = f"{uuid.uuid4().hex[:8]}@pg-test.invalid"

    r = asyncio.run(sheets.post_transaction(32.4, "Gasto Variable", "Comida", email, fecha="2026-05-06"))
    _check(pg, r["id"], "Comida", 32.4)
    r2 = asyncio.run(sheets.post_transaction(5.0, "Gasto Variable", "Café", email))
    _check(pg, r2["id"], "Café", 5.0)

    asyncio.run(sheets.update_transaction(r["id"], email, {"concepto": "Cena"}))
    _check(pg, r["id"], "Cena", 32.4)
    asyncio.run(sheets.update_transaction(r["id"], email, {"importe": 40.25, "tipo": "Gasto Fijo"}))
    _check(pg, r["id"], "Cena", 40.25)

    with pg.db.db_cursor() as cur:
        cur.execute("INSERT INTO pending_transactions (user_email, importe, fecha) "
                    "VALUES (%s, 34.50, '2026-07-10') RETURNING id", (email,))
        pid = cur.fetchone()["id"]
    t = asyncio.run(pending.categorize_pending(pid, email, "Gasto Variable", "Supermercado"))
    _check(pg, t["id"], "Supermercado", 34.5)

    fin = asyncio.run(sheets.get_finance_data(email))
    assert fin["unreadable"] == 0
    assert sorted(x["concepto"] for x in fin["transactions"]) == sorted(["Cena", "Café", "Supermercado"])
