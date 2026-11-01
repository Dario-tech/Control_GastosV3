"""goals.py casi todo es SQL; se prueban las reglas que se resuelven antes de
tocar la BD (o con db_cursor/run_in_thread sustituidos por dobles)."""
import asyncio

import pytest
from fastapi import HTTPException

from services import goals


class FakeCursor:
    def __init__(self, fetchone=None, rowcount=1):
        self._one, self.rowcount = fetchone, rowcount
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchone(self):
        return self._one


@pytest.fixture
def fake_db(monkeypatch):
    """Sustituye db_cursor por un cursor falso configurable y run_in_thread por ejecución directa."""
    state = {"cur": FakeCursor()}

    class _Ctx:
        def __enter__(self): return state["cur"]
        def __exit__(self, *a): return False

    async def _run(fn, *a, **k):
        return fn(*a, **k)

    monkeypatch.setattr(goals, "db_cursor", lambda: _Ctx())
    monkeypatch.setattr(goals, "run_in_thread", _run)
    return state


def run(coro):
    return asyncio.run(coro)


def _status(coro):
    with pytest.raises(HTTPException) as e:
        run(coro)
    return e.value.status_code


def test_contribute_no_miembro_404(fake_db):
    fake_db["cur"] = FakeCursor(fetchone=None)
    assert _status(goals.contribute(1, "a@b.com", 10)) == 404


def test_contribute_importe_no_positivo_422(fake_db):
    fake_db["cur"] = FakeCursor(fetchone={"x": 1})
    assert _status(goals.contribute(1, "a@b.com", 0)) == 422
    assert _status(goals.contribute(1, "a@b.com", -3)) == 422


def test_update_goal_meta_inexistente_404(fake_db):
    fake_db["cur"] = FakeCursor(fetchone=None)
    assert _status(goals.update_goal(1, "a@b.com", "n", 10, "x", None)) == 404


def test_update_y_delete_solo_creador_403(fake_db):
    fake_db["cur"] = FakeCursor(fetchone={"created_by": "otro@b.com"})
    assert _status(goals.update_goal(1, "a@b.com", "n", 10, "x", None)) == 403
    assert _status(goals.delete_goal(1, "a@b.com")) == 403


def test_delete_goal_creador_ejecuta_delete(fake_db):
    fake_db["cur"] = FakeCursor(fetchone={"created_by": "a@b.com"})
    run(goals.delete_goal(1, "a@b.com"))
    assert fake_db["cur"].executed[-1][0].startswith("DELETE FROM savings_goals")


def test_share_a_uno_mismo_422(fake_db):
    fake_db["cur"] = FakeCursor(fetchone={"x": 1})
    assert _status(goals.share_goal(1, "a@b.com", "  A@B.com ")) == 422


def test_share_usuario_inexistente_respuesta_neutra(fake_db, monkeypatch):
    """Sin enumeración de emails: una cuenta inexistente responde como si se hubiera compartido
    (misma forma, con "mensaje") y NO se inserta ningún miembro."""
    cur = FakeCursor(fetchone={"x": 1})
    fake_db["cur"] = cur

    async def no_user(_):
        return None

    async def fake_get_goal(goal_id, email):
        return {"id": goal_id, "nombre": "Viaje"}
    monkeypatch.setattr(goals, "get_user", no_user)
    monkeypatch.setattr(goals, "get_goal", fake_get_goal)
    r = asyncio.run(goals.share_goal(1, "a@b.com", "x@y.com"))
    assert r["id"] == 1 and r["mensaje"] == goals.SHARE_MSG
    assert not any("INSERT INTO savings_goal_members" in q[0] for q in cur.executed)


def test_delete_contribution_inexistente_404(fake_db, monkeypatch):
    # miembro ok -> meta con creador distinto -> rowcount 0
    cur = FakeCursor(fetchone={"created_by": "otro@b.com"}, rowcount=0)
    fake_db["cur"] = cur
    assert _status(goals.delete_contribution(1, 5, "a@b.com")) == 404
    # no creador: el DELETE filtra también por user_email
    assert "user_email = %s" in cur.executed[-1][0]


def test_delete_contribution_creador_borra_cualquiera(fake_db, monkeypatch):
    cur = FakeCursor(fetchone={"created_by": "a@b.com"}, rowcount=1)
    fake_db["cur"] = cur

    async def fake_get_goal(gid, email):
        return {"id": gid}
    monkeypatch.setattr(goals, "get_goal", fake_get_goal)
    assert run(goals.delete_contribution(1, 5, "a@b.com")) == {"id": 1}
    assert "user_email" not in cur.executed[-1][0]


def test_get_goal_no_encontrada(fake_db):
    fake_db["cur"].fetchall = lambda: []  # la meta no existe o no es miembro: 0 filas
    assert _status(goals.get_goal(9, "a@b.com")) == 404
