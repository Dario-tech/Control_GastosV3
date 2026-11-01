"""SQL real de sesiones revocadas y del alta por Google (ensure_user) contra un Postgres
LOCAL desechable con schema.sql aplicado (ver tests/test_user_data_pg.py). Opcional:
solo corre con PG_TEST_URL."""
import asyncio
import os
import time
import uuid
from urllib.parse import urlparse

import pytest
from fastapi import HTTPException

PG_URL = os.environ.get("PG_TEST_URL", "")

pytestmark = pytest.mark.skipif(not PG_URL, reason="define PG_TEST_URL (Postgres local desechable) para el SQL real")


@pytest.fixture
def pg(monkeypatch):
    assert urlparse(PG_URL).hostname in ("localhost", "127.0.0.1", "::1"), "PG_TEST_URL debe ser LOCAL"
    monkeypatch.setenv("DATABASE_URL", PG_URL)
    from services import db
    monkeypatch.setattr(db, "_pool", None)
    yield db
    with db.db_cursor() as cur:
        cur.execute("DELETE FROM revoked_sessions WHERE jti LIKE 'pgtest-%'")
        cur.execute("DELETE FROM users WHERE email LIKE '%@pg-test.invalid'")
    if db._pool is not None:
        db._pool.closeall()


def test_revocadas_ensure_idempotente_persiste_y_purga(pg):
    from services import auth
    auth.ensure_revoked_sessions_table()
    auth.ensure_revoked_sessions_table()
    vivo, muerto = f"pgtest-{uuid.uuid4().hex}", f"pgtest-{uuid.uuid4().hex}"
    auth.revoke_session(vivo, time.time() + 3600)
    auth.revoke_session(muerto, time.time() - 10)      # ya caducado
    auth.revoke_session(vivo, time.time() + 3600)      # repetir no falla (ON CONFLICT)
    auth._revoked.clear()
    auth.ensure_revoked_sessions_table()               # "reinicio": recarga desde la tabla
    try:
        assert auth.is_revoked(vivo) and not auth.is_revoked(muerto)
        with pg.db_cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM revoked_sessions WHERE jti = %s", (muerto,))
            assert cur.fetchone()["n"] == 0            # caducada: borrada al arrancar
    finally:
        auth._revoked.clear()


def test_ensure_user_cerrado_y_abierto(pg, monkeypatch):
    from services import users
    email = f"{uuid.uuid4().hex[:10]}@pg-test.invalid"
    monkeypatch.delenv("ALLOW_REGISTER", raising=False)
    with pytest.raises(HTTPException) as e:
        asyncio.run(users.ensure_user(email, "N"))
    assert e.value.status_code == 403
    assert asyncio.run(users.get_user(email)) is None          # no se creó
    monkeypatch.setenv("ALLOW_REGISTER", "true")
    asyncio.run(users.ensure_user(email, "Nuevo"))
    assert asyncio.run(users.get_password_hash(email)) is None  # alta por Google: sin hash
    monkeypatch.delenv("ALLOW_REGISTER")
    r = asyncio.run(users.ensure_user(email, "Renombrado"))     # existente: entra y actualiza nombre
    assert r["name"] == "Renombrado"


def test_ensure_user_no_toca_password_hash_existente(pg, monkeypatch):
    from services import users
    email = f"{uuid.uuid4().hex[:10]}@pg-test.invalid"
    monkeypatch.setenv("ALLOW_REGISTER", "true")
    asyncio.run(users.create_user_with_password(email, "A", "hash-de-prueba"))
    asyncio.run(users.ensure_user(email, "A"))
    assert asyncio.run(users.get_password_hash(email)) == "hash-de-prueba"
