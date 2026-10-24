"""services/importes.py: tope común y redondeo a céntimos (ROUND_HALF_UP) que
comparten todas las escrituras de importe."""
import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException

from services import goals, importes, wallet
from services.importes import IMPORTE_MAX, redondear_importe, validar_importe


@pytest.mark.parametrize("v,esperado", [
    (0.125, 0.13), (2.675, 2.68), (1.005, 1.01), (10.004, 10.0), (12, 12.0),
    (Decimal("34.505"), 34.51), (Decimal("34.50"), 34.5), (999_999.995, 1_000_000.0),
])
def test_redondear_importe(v, esperado):
    assert redondear_importe(v) == esperado


def test_redondear_es_idempotente_y_cifrado_coincide_con_numeric():
    for v in (0.125, 2.675, 1.005, 33.333, 7.0):
        r = redondear_importe(v)
        assert redondear_importe(r) == r
        # repr(r) (lo que cifra encrypt_float) tiene ≤ 2 decimales: NUMERIC(…,2) no lo altera
        assert Decimal(repr(r)) == Decimal(repr(r)).quantize(Decimal("0.01"))


@pytest.mark.parametrize("v", [float("nan"), float("inf"), -float("inf"), 1e300, 10**400, True, None, "x"])
def test_redondear_importe_invalido(v):
    with pytest.raises(ValueError):
        redondear_importe(v)


@pytest.mark.parametrize("v", [0, -1, 0.004, IMPORTE_MAX + 0.01, 1e8, True, "12", None,
                               float("nan"), float("inf"), 1e300])
def test_validar_importe_invalido(v):
    with pytest.raises(ValueError) as e:
        validar_importe(v)
    assert str(e.value) == "importe inválido"  # sin eco del valor


def test_validar_importe_limites():
    assert validar_importe(IMPORTE_MAX) == IMPORTE_MAX
    assert validar_importe(0.005) == 0.01
    assert validar_importe(Decimal("12.345")) == 12.35
    assert validar_importe(50, maximo=100) == 50
    with pytest.raises(ValueError):
        validar_importe(101, maximo=100)


def test_tope_cabe_en_numeric_10_2():
    assert IMPORTE_MAX < 10 ** 8  # importe NUMERIC(10,2) de PROD
    assert wallet.IMPORTE_MAX <= importes.IMPORTE_MAX


# ── Wallet (/api/pending) usa el mismo redondeo ──────────────────────────────

@pytest.mark.parametrize("raw,esperado", [(2.675, 2.68), ("1,005", 1005.0), ("0,125", 0.13), (0.125, 0.13)])
def test_wallet_redondeo_half_up(raw, esperado):
    assert wallet.parse_importe(raw) == esperado


# ── Atajo (/api/shortcut/pending) ────────────────────────────────────────────

@pytest.fixture
def shortcut_ok(monkeypatch):
    import main
    created = []

    async def email_by_token(token):
        return "user@example.com" if token == "tok-valido" else None

    async def create(email, importe, fecha=None, fuente=None):
        created.append(importe)
        return {"id": 1, "importe": importe}

    async def no_broadcast():
        return None
    monkeypatch.setattr(main, "get_email_by_shortcut_token", email_by_token)
    monkeypatch.setattr(main, "create_pending", create)
    monkeypatch.setattr(main, "_broadcast", no_broadcast)
    return created


@pytest.mark.parametrize("importe,esperado", [(2.675, 2.68), ("0,125", 0.13), (999_999.995, 1_000_000.0)])
def test_shortcut_redondea(client, shortcut_ok, importe, esperado):
    r = client.post("/api/shortcut/pending", json={"shortcut_token": "tok-valido", "importe": importe})
    assert r.status_code == 200
    assert shortcut_ok == [esperado]


@pytest.mark.parametrize("importe", [0.004, "0,004", 1_000_000.006])
def test_shortcut_redondeado_fuera_de_rango_422(client, shortcut_ok, importe):
    r = client.post("/api/shortcut/pending", json={"shortcut_token": "tok-valido", "importe": importe})
    assert r.status_code == 422
    assert shortcut_ok == []


# ── Gastos anuales y aportaciones a metas: mismo tope ────────────────────────

@pytest.mark.parametrize("importe", [1_000_000.01, 1e10, 1e300, 0.004])
def test_annual_expense_importe_fuera_de_rango_422(client, auth_headers, importe):
    r = client.post("/api/annual-expenses", headers=auth_headers,
                    json={"nombre": "IBI", "importe": importe, "mes": 5})
    assert r.status_code == 422


def test_annual_expense_redondea(client, auth_headers, monkeypatch):
    import main
    vistos = []

    async def create(email, nombre, importe, *a):
        vistos.append(importe)
        return {"id": 1}
    monkeypatch.setattr(main, "create_annual_expense", create)
    r = client.post("/api/annual-expenses", headers=auth_headers,
                    json={"nombre": "IBI", "importe": 300.125, "mes": 5})
    assert r.status_code == 200 and vistos == [300.13]


def test_contribute_tope_y_redondeo(monkeypatch):
    escritos = []

    class Cur:
        def execute(self, sql, params=None):
            if sql.startswith("INSERT INTO savings_goal_contributions"):
                escritos.append(params[2])

        def fetchone(self):
            return {"x": 1}

    class Ctx:
        def __enter__(self): return Cur()
        def __exit__(self, *a): return False

    async def run(fn):
        return fn()

    async def get_goal(goal_id, email):
        return {"id": goal_id}
    monkeypatch.setattr(goals, "db_cursor", lambda: Ctx())
    monkeypatch.setattr(goals, "run_in_thread", run)
    monkeypatch.setattr(goals, "get_goal", get_goal)

    for v in (1_000_000.01, 1e10):
        with pytest.raises(HTTPException) as e:
            asyncio.run(goals.contribute(1, "a@b.com", v))
        assert e.value.status_code == 422
    asyncio.run(goals.contribute(1, "a@b.com", 2.675))
    assert escritos == [2.68]
