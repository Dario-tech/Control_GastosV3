"""Gastos compartidos contra un Postgres REAL (opcional: solo con PG_TEST_URL a un Postgres LOCAL
desechable). Crea una base temporal con schema.sql completo y la borra al terminar."""
import asyncio
import os
import uuid
from urllib.parse import urlparse, urlunparse

import pytest
from fastapi import HTTPException

PG_URL = os.environ.get("PG_TEST_URL", "")
pytestmark = pytest.mark.skipif(not PG_URL, reason="define PG_TEST_URL (Postgres local desechable)")

A, B = "a@pg-test.invalid", "b@pg-test.invalid"


@pytest.fixture
def pg(monkeypatch):
    assert urlparse(PG_URL).hostname in ("localhost", "127.0.0.1", "::1"), "PG_TEST_URL debe ser LOCAL"
    import psycopg2
    nombre = f"shared_{uuid.uuid4().hex[:8]}"
    admin = psycopg2.connect(PG_URL)
    admin.autocommit = True
    admin.cursor().execute(f"CREATE DATABASE {nombre}")
    url = urlunparse(urlparse(PG_URL)._replace(path=f"/{nombre}"))
    con = psycopg2.connect(url)
    con.autocommit = True
    con.cursor().execute(open(os.path.join(os.path.dirname(__file__), "..", "schema.sql"), encoding="utf-8").read())
    for e in (A, B):
        con.cursor().execute("INSERT INTO users (email, name) VALUES (%s, %s)", (e, e))
    con.close()
    from services import db, legacy_plain
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(legacy_plain, "_enabled", False)
    try:
        yield db
    finally:
        if db._pool is not None:
            db._pool.closeall()
        admin.cursor().execute(f"DROP DATABASE {nombre} WITH (FORCE)")
        admin.close()


def run(c):
    return asyncio.run(c)


def _persona(shared, email, nombre):
    st = run(shared.add_person(email, nombre))
    return next(p for p in st["personas"] if p["nombre"] == nombre)


def _gasto(shared, email, importe, reparto, pagado_por=None, **kw):
    return run(shared.add_expense(email, importe, "Gasto Variable", kw.get("concepto", "Cena"), kw.get("fecha"),
                                  None, kw.get("id_cliente"), pagado_por, reparto, kw.get("etiqueta")))


def _mis_movimientos(db, email):
    from services import crypto
    with db.db_cursor() as cur:
        cur.execute("SELECT id, importe_enc, concepto_enc FROM transactions WHERE user_email = %s ORDER BY id", (email,))
        return [(r["id"], crypto.decrypt_float(bytes(r["importe_enc"]))) for r in cur.fetchall()]


def test_pago_mio_cuenta_el_total_y_se_crea_la_deuda(pg):
    from services import shared
    ana = _persona(shared, A, "Ana")
    luis = _persona(shared, A, "Luis")
    r = _gasto(shared, A, 60, {"modo": "igual", "participantes": ["yo", ana["clave"], luis["clave"]]}, etiqueta="Lisboa")
    assert _mis_movimientos(pg, A) == [(r["id"], 60.0)]            # cuenta lo que pagué
    saldos = {p["nombre"]: p["saldo"] for p in r["personas"]}
    assert saldos == {"Ana": 20.0, "Luis": 20.0} and r["saldo_total"] == 40.0
    info = r["por_transaccion"][str(r["id"])]
    assert info["total"] == 60.0 and info["mi_parte"] == 20.0 and info["pagado_por_mi"] and info["etiqueta"] == "Lisboa"


def test_si_paga_otra_persona_mi_movimiento_es_mi_parte(pg):
    from services import shared
    ana = _persona(shared, A, "Ana")
    r = _gasto(shared, A, 50, {"modo": "igual", "participantes": ["yo", ana["clave"]]}, pagado_por=ana["clave"])
    assert _mis_movimientos(pg, A) == [(r["id"], 25.0)]
    assert r["personas"][0]["saldo"] == -25.0                        # le debo 25


def test_liquidar_es_neutral_y_salda(pg):
    from services import shared
    ana = _persona(shared, A, "Ana")
    _gasto(shared, A, 40, {"modo": "igual", "participantes": ["yo", ana["clave"]]})
    antes = _mis_movimientos(pg, A)
    st = run(shared.add_settlement(A, ana["id"], "cobro", 20, "2026-05-06"))
    assert st["personas"][0]["saldo"] == 0.0
    assert _mis_movimientos(pg, A) == antes                          # ni ingreso ni gasto
    st = run(shared.delete_settlement(A, st["pagos"][0]["id"]))
    assert st["personas"][0]["saldo"] == 20.0


def test_borrar_el_movimiento_borra_el_reparto_y_al_reves(pg):
    from services import shared, sheets
    ana = _persona(shared, A, "Ana")
    r = _gasto(shared, A, 40, {"modo": "igual", "participantes": ["yo", ana["clave"]]})
    run(sheets.delete_transaction(r["id"], A))                       # el borrado normal de Mes
    assert run(shared.get_state(A))["gastos"] == []
    r = _gasto(shared, A, 40, {"modo": "igual", "participantes": ["yo", ana["clave"]]})
    st = run(shared.delete_expense(A, r["gastos"][0]["id"]))
    assert st["gastos"] == [] and _mis_movimientos(pg, A) == []


def test_reintento_con_id_cliente_no_duplica(pg):
    from services import shared
    ana = _persona(shared, A, "Ana")
    rep = {"modo": "igual", "participantes": ["yo", ana["clave"]]}
    r1 = _gasto(shared, A, 40, rep, id_cliente="abcdefgh-1")
    r2 = _gasto(shared, A, 40, rep, id_cliente="abcdefgh-1")
    assert r2.get("duplicada") and r2["id"] == r1["id"]
    assert len(_mis_movimientos(pg, A)) == 1 and len(r2["gastos"]) == 1


def test_aislamiento_entre_usuarios(pg):
    from services import shared
    ana = _persona(shared, A, "Ana")
    r = _gasto(shared, A, 40, {"modo": "igual", "participantes": ["yo", ana["clave"]]})
    st_b = run(shared.get_state(B))
    assert st_b["personas"] == [] and st_b["gastos"] == [] and st_b["por_transaccion"] == {}
    # B no puede usar la persona de A ni tocar sus gastos/pagos
    with pytest.raises(HTTPException) as e:
        run(shared.add_settlement(B, ana["id"], "cobro", 5, "2026-05-06"))
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        _gasto(shared, B, 10, {"modo": "igual", "participantes": ["yo", ana["clave"]]})
    assert e.value.status_code == 422
    for f in (lambda: shared.delete_expense(B, r["gastos"][0]["id"]), lambda: shared.delete_person(B, ana["id"])):
        with pytest.raises(HTTPException) as e:
            run(f())
        assert e.value.status_code == 404
    assert len(run(shared.get_state(A))["gastos"]) == 1


def test_no_se_borra_una_persona_con_gastos_y_todo_va_cifrado(pg):
    from services import shared
    ana = _persona(shared, A, "Ana")
    _gasto(shared, A, 40, {"modo": "igual", "participantes": ["yo", ana["clave"]]}, etiqueta="Piso")
    with pytest.raises(HTTPException) as e:
        run(shared.delete_person(A, ana["id"]))
    assert e.value.status_code == 422
    with pg.db_cursor() as cur:
        for t, col in (("shared_people", "nombre_enc"), ("shared_expenses", "total_enc"),
                       ("shared_expenses", "etiqueta_enc"), ("shared_shares", "share_enc")):
            cur.execute(f"SELECT {col} FROM {t}")
            for r in cur.fetchall():
                assert b"Ana" not in bytes(r[col]) and b"Piso" not in bytes(r[col])


def test_validaciones_de_reparto(pg):
    from services import shared
    ana = _persona(shared, A, "Ana")
    for rep in ({"modo": "igual", "participantes": ["yo"]},                       # sin nadie más
                {"modo": "importes", "partes": {"yo": 10, ana["clave"]: 20}},     # no suma 40
                {"modo": "igual", "participantes": ["yo", "p:99999"]}):           # persona ajena
        with pytest.raises(HTTPException) as e:
            _gasto(shared, A, 40, rep)
        assert e.value.status_code == 422
    r = _gasto(shared, A, 40, {"modo": "importes", "partes": {"yo": 10, ana["clave"]: 30}})
    assert r["personas"][0]["saldo"] == 30.0
