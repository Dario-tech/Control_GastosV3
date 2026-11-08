"""Gastos compartidos contra un Postgres REAL y LOCAL desechable (PG_TEST_URL):
aislamiento entre usuarios, permisos, cifrado en reposo y saldos."""
import asyncio
import os
import uuid
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

import pytest
from fastapi import HTTPException

PG_URL = os.environ.get("PG_TEST_URL", "")
pytestmark = pytest.mark.skipif(not PG_URL, reason="define PG_TEST_URL (Postgres local desechable)")

A, B, C, D = "a@pg-test.invalid", "b@pg-test.invalid", "c@pg-test.invalid", "d@pg-test.invalid"


def _url(url, schema):
    p = urlparse(url)
    q = dict(parse_qsl(p.query))
    q["options"] = f"-csearch_path={schema}"
    return urlunparse(p._replace(query=urlencode(q)))


@pytest.fixture
def pg(monkeypatch):
    assert urlparse(PG_URL).hostname in ("localhost", "127.0.0.1", "::1")
    import psycopg2
    schema = f"gr_{uuid.uuid4().hex[:10]}"
    admin = psycopg2.connect(PG_URL)
    admin.autocommit = True
    with admin.cursor() as c:
        c.execute(f"CREATE SCHEMA {schema}")
        c.execute(f"CREATE TABLE {schema}.users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', shortcut_token TEXT UNIQUE, password_hash TEXT)")
        for e, n in ((A, "Ana"), (B, "Beto"), (C, "Cris"), (D, "Dani")):
            c.execute(f"INSERT INTO {schema}.users (email, name) VALUES (%s, %s)", (e, n))
    from services import db, groups
    monkeypatch.setenv("DATABASE_URL", _url(PG_URL, schema))
    monkeypatch.setattr(db, "_pool", None)
    groups.ensure_groups_tables()
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


def err(coro):
    with pytest.raises(HTTPException) as e:
        run(coro)
    return e.value.status_code


def grupo_abc():
    from services import groups
    g = run(groups.create_group(A, "Viaje"))
    run(groups.invite(g["id"], A, B))
    run(groups.invite(g["id"], A, C))
    return g["id"]


def test_esquema_idempotente(pg):
    from services import groups
    groups.ensure_groups_tables()
    groups.ensure_groups_tables()
    with pg.db_cursor() as cur:
        cur.execute("SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relkind = 'r' AND relname ~ '^(expense_|group_)'")
        rows = {r["relname"]: r["relrowsecurity"] for r in cur.fetchall()}
    assert len(rows) == 5 and all(rows.values())


def test_flujo_gasto_igual_saldos_y_pago(pg):
    from services import groups
    gid = grupo_abc()
    g = run(groups.add_expense(gid, A, "Cena", 90, "2025-03-01", None, {"modo": "igual"}))
    assert g["saldos"] == {A: 60.0, B: -30.0, C: -30.0}
    assert {(d["de"], d["a"], d["importe"]) for d in g["deudas"]} == {(B, A, 30.0), (C, A, 30.0)}
    g = run(groups.add_expense(gid, B, "Taxi", 20, "2025-03-02", B, {"modo": "importes", "partes": {A: 5, B: 5, C: 10}}))
    assert sum(g["saldos"].values()) == 0
    g = run(groups.add_settlement(gid, B, B, A, 30, None))
    # B: pagó 20, debe 30 + 5 = 35, pagó 30 a A → 20 - 35 + 30 = 15
    assert g["saldos"][B] == 15.0 and g["saldos"][A] == 60.0 - 5 - 30 and g["saldos"][C] == -40.0
    assert [m["nombre"] for m in g["miembros"]] == ["Ana", "Beto", "Cris"]


def test_importes_cifrados_en_reposo(pg):
    from services import groups
    gid = grupo_abc()
    run(groups.add_expense(gid, A, "Cena secreta", 12.34, None, None, {"modo": "igual"}))
    with pg.db_cursor() as cur:
        cur.execute("SELECT g.nombre_enc, e.concepto_enc, e.importe_enc, s.share_enc FROM expense_groups g "
                    "JOIN group_expenses e ON e.group_id = g.id JOIN group_expense_shares s ON s.expense_id = e.id")
        for r in cur.fetchall():
            for blob in r.values():
                assert b"Viaje" not in bytes(blob) and b"secreta" not in bytes(blob) and b"12.34" not in bytes(blob)


def test_aislamiento_no_miembro_404_en_todo(pg):
    from services import groups
    gid = grupo_abc()
    g = run(groups.add_expense(gid, A, "Cena", 30, None, None, {"modo": "igual"}))
    eid = g["gastos"][0]["id"]
    g = run(groups.add_settlement(gid, B, B, A, 5, None))
    pid = g["pagos"][0]["id"]
    # D no es miembro: nada se filtra, y el error es idéntico al de un grupo inexistente
    assert run(groups.list_groups(D)) == []
    llamadas = [
        lambda gi: groups.get_group(gi, D),
        lambda gi: groups.delete_group(gi, D),
        lambda gi: groups.invite(gi, D, C),
        lambda gi: groups.add_expense(gi, D, "x", 1, None, None, {"modo": "igual"}),
        lambda gi: groups.delete_expense(gi, eid, D),
        lambda gi: groups.add_settlement(gi, D, D, A, 1, None),
        lambda gi: groups.delete_settlement(gi, pid, D),
    ]
    for f in llamadas:
        assert err(f(gid)) == 404
        assert err(f(999999)) == 404
    # nada cambió
    assert len(run(groups.get_group(gid, A))["gastos"]) == 1


def test_gasto_de_otro_grupo_da_404(pg):
    from services import groups
    gid = grupo_abc()
    otro = run(groups.create_group(D, "Otro"))["id"]
    g = run(groups.add_expense(otro, D, "Privado", 10, None, None, {"modo": "igual"}))
    eid = g["gastos"][0]["id"]
    assert err(groups.delete_expense(gid, eid, A)) == 404   # A es miembro de gid pero el gasto es de `otro`
    assert len(run(groups.get_group(otro, D))["gastos"]) == 1


def test_listas_solo_los_grupos_propios(pg):
    from services import groups
    grupo_abc()
    run(groups.create_group(D, "De Dani"))
    assert [g["nombre"] for g in run(groups.list_groups(D))] == ["De Dani"]
    assert [g["nombre"] for g in run(groups.list_groups(B))] == ["Viaje"]


def test_pagador_y_participantes_deben_ser_miembros(pg):
    from services import groups
    gid = grupo_abc()
    assert err(groups.add_expense(gid, A, "x", 10, None, D, {"modo": "igual"})) == 422
    assert err(groups.add_expense(gid, A, "x", 10, None, None, {"modo": "igual", "participantes": [D]})) == 422
    assert err(groups.add_expense(gid, A, "x", 10, None, None, {"modo": "importes", "partes": {A: 3, B: 3}})) == 422
    assert err(groups.add_settlement(gid, A, A, D, 5, None)) == 422
    assert err(groups.add_settlement(gid, A, A, A, 5, None)) == 422
    assert err(groups.add_settlement(gid, A, B, C, 5, None)) == 403   # A no es parte del pago


def test_permisos_de_borrado(pg):
    from services import groups
    gid = grupo_abc()
    g = run(groups.add_expense(gid, B, "De B", 30, None, None, {"modo": "igual"}))
    eid = g["gastos"][0]["id"]
    assert err(groups.delete_expense(gid, eid, C)) == 403          # otro miembro no puede
    assert len(run(groups.delete_expense(gid, eid, A))["gastos"]) == 0   # el creador del grupo sí
    g = run(groups.add_expense(gid, B, "De B", 30, None, None, {"modo": "igual"}))
    assert len(run(groups.delete_expense(gid, g["gastos"][0]["id"], B))["gastos"]) == 0   # quien lo creó
    assert err(groups.delete_group(gid, B)) == 403                 # solo el creador borra el grupo
    run(groups.delete_group(gid, A))
    assert err(groups.get_group(gid, A)) == 404


def test_invitacion_neutra_y_limites(pg):
    from services import groups
    g = run(groups.create_group(A, "G"))
    existe = run(groups.invite(g["id"], A, B))
    no_existe = run(groups.invite(g["id"], A, "nadie@pg-test.invalid"))
    assert existe["mensaje"] == no_existe["mensaje"] == groups.INVITE_MSG
    assert [m["email"] for m in no_existe["miembros"]] == [A, B]
    assert err(groups.invite(g["id"], A, A)) == 422
    # repetir una invitación no duplica ni falla
    assert len(run(groups.invite(g["id"], A, B))["miembros"]) == 2
    for i in range(groups.MAX_GRUPOS_CREADOS - 1):
        run(groups.create_group(A, f"g{i}"))
    assert err(groups.create_group(A, "uno más")) == 422
