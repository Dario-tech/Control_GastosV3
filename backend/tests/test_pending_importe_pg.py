"""Importe de los pendientes cifrado (importe_enc + importe_hmac) contra un
Postgres REAL y LOCAL desechable (PG_TEST_URL). Cada test usa un schema propio:
tabla `pending_transactions` ANTIGUA (importe NUMERIC NOT NULL, sin columnas
nuevas) a la que se aplica la migración del backend, como en un despliegue."""
import asyncio
import os
import uuid
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

import pytest

from services import crypto

PG_URL = os.environ.get("PG_TEST_URL", "")
pytestmark = pytest.mark.skipif(not PG_URL, reason="define PG_TEST_URL (Postgres local desechable)")

EMAIL = "pend@pg-test.invalid"


def _url(url, schema):
    p = urlparse(url)
    q = dict(parse_qsl(p.query))
    q["options"] = f"-csearch_path={schema}"
    return urlunparse(p._replace(query=urlencode(q)))


@pytest.fixture
def pg(monkeypatch):
    assert urlparse(PG_URL).hostname in ("localhost", "127.0.0.1", "::1")
    import psycopg2
    schema = f"pi_{uuid.uuid4().hex[:10]}"
    admin = psycopg2.connect(PG_URL)
    admin.autocommit = True
    with admin.cursor() as c:
        c.execute(f"CREATE SCHEMA {schema}")
        c.execute(f"""CREATE TABLE {schema}.pending_transactions (
            id SERIAL PRIMARY KEY, user_email TEXT NOT NULL,
            importe NUMERIC(12,2) NOT NULL, fecha DATE NOT NULL DEFAULT CURRENT_DATE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(), comercio_enc BYTEA,
            comercio_hmac BYTEA, fuente TEXT, id_externo_hmac BYTEA)""")
        c.execute(f"""CREATE TABLE {schema}.transactions (
            id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, fecha DATE NOT NULL DEFAULT CURRENT_DATE,
            tipo TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), comentario TEXT,
            concepto_enc BYTEA, importe_enc BYTEA)""")
        c.execute(f"""CREATE TABLE {schema}.merchant_rules (
            user_email TEXT, comercio_hmac BYTEA, tipo TEXT, concepto_enc BYTEA,
            hits INT NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (user_email, comercio_hmac))""")
    from services import db, legacy_plain
    monkeypatch.setenv("DATABASE_URL", _url(PG_URL, schema))
    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(legacy_plain, "_enabled", False)
    try:
        yield db
    finally:
        if db._pool is not None:
            db._pool.closeall()
        with admin.cursor() as c:
            c.execute(f"DROP SCHEMA {schema} CASCADE")
        admin.close()


def _all(db, sql="SELECT * FROM pending_transactions ORDER BY id"):
    with db.db_cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def _migrar():
    from services import pending
    pending.ensure_pending_importe_schema()


def test_migracion_idempotente_y_importe_admite_null(pg):
    _migrar()
    _migrar()
    with pg.db_cursor() as cur:
        cur.execute("SELECT is_nullable FROM information_schema.columns "
                    "WHERE table_name='pending_transactions' AND column_name='importe' "
                    "AND table_schema = current_schema()")
        assert cur.fetchone()["is_nullable"] == "YES"
    with pg.db_cursor() as cur:
        cur.execute("SELECT column_name FROM information_schema.columns "
                    "WHERE table_name='pending_transactions' AND table_schema = current_schema()")
        assert {"importe_enc", "importe_hmac"} <= {r["column_name"] for r in cur.fetchall()}


def test_schema_sql_nuevo_deja_importe_null_en_pendientes_nuevos(pg, monkeypatch):
    """BD con schema.sql aplicado (dos veces: idempotente) en el Postgres local:
    `importe` admite NULL y un pendiente nuevo lo deja NULL con importe_enc e
    importe_hmac rellenos. Usa el schema public con un usuario propio (se borra)."""
    from services import pending
    sql = open(os.path.join(os.path.dirname(__file__), "..", "schema.sql"), encoding="utf-8").read()
    if pg._pool is not None:
        pg._pool.closeall()
    monkeypatch.setattr(pg, "_pool", None)
    monkeypatch.setenv("DATABASE_URL", PG_URL)
    email = f"{uuid.uuid4().hex[:8]}@pg-test.invalid"
    with pg.db_cursor() as cur:
        cur.execute(sql)
        cur.execute(sql)
        cur.execute("INSERT INTO users (email, name) VALUES (%s, 'x')", (email,))
    try:
        r = asyncio.run(pending.create_pending_dedup(email, 8.5, "2026-07-10", "Cafe", None, "wallet"))
        with pg.db_cursor() as cur:
            cur.execute("SELECT importe, importe_enc, importe_hmac FROM pending_transactions WHERE id = %s",
                        (r["id"],))
            row = cur.fetchone()
        assert row["importe"] is None and row["importe_enc"] is not None and row["importe_hmac"] is not None
        assert crypto.decrypt_float(bytes(row["importe_enc"])) == 8.5
    finally:
        with pg.db_cursor() as cur:
            cur.execute("DELETE FROM users WHERE email = %s", (email,))  # cascada


def test_alta_guarda_cifrado_y_deja_importe_null(pg):
    from services import pending
    _migrar()
    r = asyncio.run(pending.create_pending_dedup(EMAIL, 34.5, "2026-07-10", "Mercadona", "id-1", "wallet"))
    r2 = asyncio.run(pending.create_pending(EMAIL, 5.25, "2026-07-11", fuente="atajo"))
    r3 = asyncio.run(pending.create_pending(EMAIL, 7.0, None, fuente="atajo"))
    assert r["importe"] == 34.5 and r2["importe"] == 5.25
    rows = _all(pg)
    assert len(rows) == 3
    for row, esperado in zip(rows, (34.5, 5.25, 7.0)):
        assert row["importe"] is None
        assert crypto.decrypt_float(bytes(row["importe_enc"])) == esperado
        assert bytes(row["importe_hmac"]) == pending.importe_tag(esperado)
    assert rows[0]["importe_enc"] is not None and b"34.5" not in bytes(rows[0]["importe_enc"])
    got = asyncio.run(pending.get_pending(EMAIL))
    assert [g["importe"] for g in got] == [34.5, 5.25, 7.0]
    assert got[0]["comercio"] == "Mercadona"


def test_categorizar_crea_transaccion_y_borra_pendiente(pg):
    from services import pending
    _migrar()
    r = asyncio.run(pending.create_pending_dedup(EMAIL, 34.5, "2026-07-10", "Mercadona", None, "wallet"))
    tx = asyncio.run(pending.categorize_pending(r["id"], EMAIL, "Gasto Variable", "Super"))
    rows = _all(pg, "SELECT * FROM transactions")
    assert len(rows) == 1 and rows[0]["id"] == tx["id"]
    assert crypto.decrypt_float(bytes(rows[0]["importe_enc"])) == 34.5
    assert _all(pg) == []


def test_dedup_sql_importe_comercio_e_id_externo(pg):
    from services import pending
    _migrar()
    f = lambda *a, **k: asyncio.run(pending.create_pending_dedup(EMAIL, *a, **k))
    a = f(10.0, "2026-07-10", "Zara", None, "wallet")
    assert not a["duplicada"]
    b = f(10.0, "2026-07-10", "ZARA ", None, "wallet")          # mismo importe+comercio
    assert b["duplicada"] and b["id"] == a["id"] and b["importe"] == 10.0
    assert not f(10.01, "2026-07-10", "Zara", None, "wallet")["duplicada"]   # otro importe
    assert not f(10.0, "2026-07-10", "H&M", None, "wallet")["duplicada"]     # otro comercio
    assert not f(20.0, "2026-07-10", None, None, "manual")["duplicada"]      # manual sin comercio
    assert not f(20.0, "2026-07-10", None, None, "manual")["duplicada"]
    assert f(30.0, "2026-07-10", None, None, "wallet")["duplicada"] is False
    assert f(30.0, "2026-07-10", None, None, "wallet")["duplicada"] is True  # wallet sin comercio
    i1 = f(1.0, "2026-07-10", None, "ext-1", "manual")
    i2 = f(99.0, "2026-07-10", "Otro", "ext-1", "manual")                    # mismo id_externo
    assert i2["duplicada"] and i2["id"] == i1["id"]
    # pasados 2 min ya no es duplicado por importe+comercio
    with pg.db_cursor() as cur:
        cur.execute("UPDATE pending_transactions SET created_at = now() - interval '3 minutes' WHERE id = %s",
                    (a["id"],))
    assert not f(10.0, "2026-07-10", "Zara", None, "wallet")["duplicada"]


def _antiguo(db, importe, comercio=None):
    from services import pending
    with db.db_cursor() as cur:
        cur.execute("INSERT INTO pending_transactions (user_email, importe, fecha, comercio_enc, comercio_hmac, fuente)"
                    " VALUES (%s, %s, '2026-07-01', %s, %s, 'wallet') RETURNING id",
                    (EMAIL, importe, crypto.encrypt_str(comercio) if comercio else None,
                     pending.merchant_tag(comercio)))
        return cur.fetchone()["id"]


def test_pendiente_antiguo_se_lee_categoriza_y_backfill_no_toca_el_claro(pg):
    from services import pending
    pid = _antiguo(pg, 12.34, "Bar")
    pid2 = _antiguo(pg, 50)
    _migrar()
    got = asyncio.run(pending.get_pending(EMAIL))                 # lee el claro
    assert sorted(g["importe"] for g in got) == [12.34, 50.0]
    # un alta igual al antiguo (sin importe_hmac) no se detecta como duplicada: ventana de 2 min
    assert not asyncio.run(pending.create_pending_dedup(EMAIL, 12.34, "2026-07-01", "Bar", None, "wallet"))["duplicada"]

    assert pending.backfill_pending_importe() == 2
    assert pending.backfill_pending_importe() == 0                # idempotente
    rows = {r["id"]: r for r in _all(pg)}
    for pid_, imp in ((pid, 12.34), (pid2, 50.0)):
        assert float(rows[pid_]["importe"]) == imp                # claro intacto
        assert crypto.decrypt_float(bytes(rows[pid_]["importe_enc"])) == imp
        assert bytes(rows[pid_]["importe_hmac"]) == pending.importe_tag(imp)
    # tras el backfill el dedup ya lo reconoce
    d = asyncio.run(pending.create_pending_dedup(EMAIL, 50.0, "2026-07-01", None, None, "wallet"))
    assert d["duplicada"] and d["id"] == pid2


def test_antiguo_se_categoriza_sin_backfill(pg):
    from services import pending
    pid = _antiguo(pg, 12.34)
    _migrar()
    asyncio.run(pending.categorize_pending(pid, EMAIL, "Gasto Variable", "X"))
    rows = _all(pg, "SELECT * FROM transactions")
    assert crypto.decrypt_float(bytes(rows[0]["importe_enc"])) == 12.34


def test_fila_no_descifrable_no_revienta(pg, caplog):
    from fastapi import HTTPException
    from services import pending
    _migrar()
    ok = asyncio.run(pending.create_pending(EMAIL, 3.0, "2026-07-01", fuente="atajo"))
    mala = asyncio.run(pending.create_pending(EMAIL, 4.0, "2026-07-01", fuente="atajo"))
    with pg.db_cursor() as cur:
        cur.execute("UPDATE pending_transactions SET importe_enc = %s WHERE id = %s",
                    (b"\x00" * 40, mala["id"]))
    with caplog.at_level("WARNING"):
        got = asyncio.run(pending.get_pending(EMAIL))
    assert [g["id"] for g in got] == [ok["id"]]
    assert "4.0" not in caplog.text and str(mala["id"]) in caplog.text
    with pytest.raises(HTTPException) as e:
        asyncio.run(pending.categorize_pending(mala["id"], EMAIL, "Gasto Variable", "X"))
    assert e.value.status_code == 422
    assert asyncio.run(pending.delete_pending(mala["id"], EMAIL))["status"] == "ok"
    assert pending.backfill_pending_importe() == 0


def test_backfill_no_rompe_si_falla(monkeypatch):
    from services import pending

    def boom():
        raise RuntimeError("sin BD")
    monkeypatch.setattr(pending, "db_cursor", boom)
    assert pending.backfill_pending_importe() == 0
