"""Metas contra un Postgres REAL y LOCAL desechable (PG_TEST_URL): lista sin fotos,
ruta de foto solo para miembros, nº de consultas constante e índices idempotentes."""
import asyncio
import os
import uuid
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

import pytest
from fastapi import HTTPException

PG_URL = os.environ.get("PG_TEST_URL", "")
pytestmark = pytest.mark.skipif(not PG_URL, reason="define PG_TEST_URL (Postgres local desechable)")

A, B, C = "a@pg-test.invalid", "b@pg-test.invalid", "c@pg-test.invalid"
FOTO = "data:image/jpeg;base64," + "A" * 5000


def _url(url, schema):
    p = urlparse(url)
    q = dict(parse_qsl(p.query))
    q["options"] = f"-csearch_path={schema}"
    return urlunparse(p._replace(query=urlencode(q)))


@pytest.fixture
def pg(monkeypatch):
    assert urlparse(PG_URL).hostname in ("localhost", "127.0.0.1", "::1")
    import psycopg2
    schema = f"g_{uuid.uuid4().hex[:10]}"
    admin = psycopg2.connect(PG_URL)
    admin.autocommit = True
    with admin.cursor() as c:
        c.execute(f"CREATE SCHEMA {schema}")
        c.execute(f"CREATE TABLE {schema}.users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', shortcut_token TEXT UNIQUE, password_hash TEXT)")
        for e, n in ((A, "Ana"), (B, "Beto"), (C, "Cris")):
            c.execute(f"INSERT INTO {schema}.users VALUES (%s, %s)", (e, n))
    from services import db, goals
    monkeypatch.setenv("DATABASE_URL", _url(PG_URL, schema))
    monkeypatch.setattr(db, "_pool", None)
    goals.ensure_goals_tables()
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


def test_lista_sin_foto_con_tiene_foto_y_ruta_de_foto(pg):
    from services import goals
    g = run(goals.create_goal(A, "Viaje", 1000, "x", None))
    run(goals.share_goal(g["id"], A, B))
    run(goals.contribute(g["id"], A, 10.1))
    g = run(goals.contribute(g["id"], B, 20.2, FOTO))
    assert all("foto" not in c for c in g["contributions"]) and g["ahorrado"] == 30.3
    assert sorted(c["tiene_foto"] for c in g["contributions"]) == [False, True]
    lista = run(goals.get_goals_for_user(A))
    assert all("foto" not in c for x in lista for c in x["contributions"])
    assert lista[0]["members"] == [A, B] and [m["name"] for m in lista[0]["memberNames"]] == ["Ana", "Beto"]
    con_foto = next(c for c in g["contributions"] if c["tiene_foto"])
    sin_foto = next(c for c in g["contributions"] if not c["tiene_foto"])
    # miembros (también la creadora, que no subió la foto) la ven
    assert run(goals.get_contribution_foto(g["id"], con_foto["id"], A)) == FOTO
    assert run(goals.get_contribution_foto(g["id"], con_foto["id"], B)) == FOTO
    # 404: no miembro, aportación sin foto, aportación de otra meta, ids inexistentes
    otra = run(goals.create_goal(C, "Otra", 5, "x", None))
    for gid, cid, who in ((g["id"], con_foto["id"], C), (g["id"], sin_foto["id"], A),
                          (otra["id"], con_foto["id"], C), (g["id"], 99999, A), (99999, 1, A)):
        with pytest.raises(HTTPException) as e:
            run(goals.get_contribution_foto(gid, cid, who))
        assert e.value.status_code == 404


def test_numero_de_consultas_constante(pg, monkeypatch):
    from services import goals
    for i in range(6):
        g = run(goals.create_goal(A, f"m{i}", 100, "x", None))
        run(goals.contribute(g["id"], A, 5, FOTO))
    n = []
    real = goals.db_cursor

    class _W:
        def __init__(self, cur): self._c = cur
        def execute(self, *a, **k):
            n.append(1)
            return self._c.execute(*a, **k)
        def __getattr__(self, name): return getattr(self._c, name)

    class counting:
        def __init__(self): self._ctx = real()
        def __enter__(self): return _W(self._ctx.__enter__())
        def __exit__(self, *a): return self._ctx.__exit__(*a)
    monkeypatch.setattr(goals, "db_cursor", counting)
    assert len(run(goals.get_goals_for_user(A))) == 6
    assert len(n) == 3
    n.clear()
    run(goals.get_goal(1, A))
    assert len(n) == 3


def test_indices_idempotentes(pg):
    from services import goals
    goals.ensure_goals_tables()
    goals.ensure_goals_tables()
    with pg.db_cursor() as cur:
        cur.execute("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()")
        names = {r["indexname"] for r in cur.fetchall()}
    assert {"idx_goal_contrib_goal", "idx_goal_members_user"} <= names
