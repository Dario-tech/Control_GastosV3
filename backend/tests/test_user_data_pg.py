"""Pruebas del SQL REAL de `user_data._PgRepo` contra un Postgres local.

Son opcionales: solo se ejecutan si defines PG_TEST_URL apuntando a un Postgres
LOCAL desechable (host localhost/127.0.0.1) que ya tenga aplicado schema.sql, p. ej.:

    docker run -d --name pg-test -e POSTGRES_USER=t -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t \
        -p 127.0.0.1:55432:5432 postgres:16-alpine
    docker exec -i pg-test psql -U t -d t < schema.sql
    PG_TEST_URL=postgresql://t:t@127.0.0.1:55432/t python -m pytest tests/test_user_data_pg.py -q

Por seguridad se niega a correr contra cualquier host que no sea local. Cada
test crea usuarios propios (@pg-test.invalid) y los borra al terminar.
"""
import os
import uuid
from urllib.parse import urlparse

import pytest
from fastapi import HTTPException

PG_URL = os.environ.get("PG_TEST_URL", "")

pytestmark = pytest.mark.skipif(not PG_URL, reason="define PG_TEST_URL (Postgres local desechable) para el SQL real")


@pytest.fixture
def pg(monkeypatch):
    host = urlparse(PG_URL).hostname
    assert host in ("localhost", "127.0.0.1", "::1"), "PG_TEST_URL debe ser un Postgres LOCAL"
    monkeypatch.setenv("DATABASE_URL", PG_URL)
    from services import db, user_data
    monkeypatch.setattr(db, "_pool", None)  # fuerza un pool nuevo con la URL de prueba
    created = []

    def new_user():
        email = f"{uuid.uuid4().hex[:10]}@pg-test.invalid"
        with db.db_cursor() as cur:
            cur.execute("INSERT INTO users (email, name, shortcut_token) VALUES (%s, %s, %s)",
                        (email, "T", uuid.uuid4().hex))
        created.append(email)
        return email

    user_data.ensure_user_data_schema()
    yield type("PG", (), {"db": db, "ud": user_data, "new_user": staticmethod(new_user)})
    with db.db_cursor() as cur:
        cur.execute("DELETE FROM users WHERE email = ANY(%s)", (created,))
    if db._pool is not None:
        db._pool.closeall()


def test_ensure_idempotente(pg):
    pg.ud.ensure_user_data_schema()
    pg.ud.ensure_user_data_schema()


def test_crud_duplicados_y_aislamiento(pg):
    ud = pg.ud
    a, b = pg.new_user(), pg.new_user()
    c = ud.create_category(a, "Gasto Variable", "Café", "☕")
    with pytest.raises(HTTPException) as e:
        ud.create_category(a, "Gasto Variable", "  café ")
    assert e.value.status_code == 409
    # mismo nombre en otro tipo y en otro usuario: permitido
    ud.create_category(a, "Ingreso", "Café")
    ud.create_category(b, "Gasto Variable", "Café")
    assert [x["concepto"] for x in ud.list_categories(a)["categories"]] == ["Café", "Café"]
    # B no toca lo de A
    with pytest.raises(HTTPException) as e:
        ud.update_category(b, c["id"], concepto="Hack")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        ud.delete_category(b, c["id"])
    assert e.value.status_code == 404
    # renombrar, solo emoji, y renombrar a duplicado
    assert ud.update_category(a, c["id"], concepto="Cafetería")["concepto"] == "Cafetería"
    r = ud.update_category(a, c["id"], emoji="🍵")
    assert r["concepto"] == "Cafetería" and r["emoji"] == "🍵"
    p = ud.create_category(a, "Gasto Variable", "Pan")
    with pytest.raises(HTTPException) as e:
        ud.update_category(a, p["id"], concepto="cafetería")
    assert e.value.status_code == 409
    ud.delete_category(a, p["id"])
    with pytest.raises(HTTPException) as e:
        ud.delete_category(a, p["id"])
    assert e.value.status_code == 404


def test_import_idempotente(pg):
    ud = pg.ud
    a = pg.new_user()
    items = [{"tipo": "Gasto Fijo", "concepto": "Gimnasio"}, {"tipo": "Gasto Fijo", "concepto": "gimnasio "},
             {"tipo": "Mal", "concepto": "x"}, "basura"]
    r1 = ud.import_categories(a, items)
    r2 = ud.import_categories(a, items)
    assert (r1["imported"], r1["skipped"]) == (1, 3)
    assert (r2["imported"], r2["skipped"]) == (0, 4)
    assert len(r2["categories"]) == 1


def test_bd_sin_texto_en_claro_y_cascada(pg):
    ud, db = pg.ud, pg.db
    a = pg.new_user()
    ud.create_category(a, "Gasto Variable", "SecretoCategoria")
    ud.put_pref(a, "settings", {"clave": "SecretoValorPref"})
    with db.db_cursor() as cur:
        cur.execute("SELECT concepto_enc FROM user_categories WHERE user_email = %s", (a,))
        assert b"SecretoCategoria" not in bytes(cur.fetchone()["concepto_enc"])
        cur.execute("SELECT data_enc FROM user_prefs WHERE user_email = %s", (a,))
        assert b"SecretoValorPref" not in bytes(cur.fetchone()["data_enc"])
        cur.execute("DELETE FROM users WHERE email = %s", (a,))
        cur.execute("SELECT (SELECT count(*) FROM user_categories WHERE user_email = %s) AS c, "
                    "(SELECT count(*) FROM user_prefs WHERE user_email = %s) AS p", (a, a))
        row = cur.fetchone()
    assert (row["c"], row["p"]) == (0, 0)  # ON DELETE CASCADE


def test_prefs_roundtrip_vacios_y_tope(pg):
    ud = pg.ud
    a, b = pg.new_user(), pg.new_user()
    assert ud.get_prefs(a)["settings"] is None
    ud.put_pref(a, "hidden_categories", [])
    ud.put_pref(a, "settings", {})
    ud.put_pref(a, "tour", False)
    ud.put_pref(a, "budgets", {"version": 3, "items": [{"name": "Ñandú €"}]})
    p = ud.get_prefs(a)
    assert p["hidden_categories"] == [] and p["settings"] == {} and p["tour"] is False
    assert p["budgets"]["items"][0]["name"] == "Ñandú €"
    ud.put_pref(a, "settings", {"x": 1})  # upsert: el último gana
    assert ud.get_prefs(a)["settings"] == {"x": 1}
    assert ud.get_prefs(b)["settings"] is None  # aislamiento
    with pytest.raises(HTTPException) as e:
        ud.put_pref(a, "settings", {"x": "a" * (64 * 1024)})
    assert e.value.status_code == 413


def test_pref_no_descifrable_devuelve_none_y_no_aparece_en_updated_at(pg):
    """Documenta el comportamiento actual: indistinguible de 'no hay nada'."""
    ud, db = pg.ud, pg.db
    a = pg.new_user()
    ud.put_pref(a, "tour", {"seen_at": "x"})
    with db.db_cursor() as cur:
        cur.execute("UPDATE user_prefs SET data_enc = %s WHERE user_email = %s", (b"\x00" * 40, a))
    p = ud.get_prefs(a)
    assert p["tour"] is None and "tour" not in p["updated_at"]
