"""Bloque B (rendimiento): equivalencia de la sugerencia agrupada, gzip sin romper
CORS ni SSE, metas sin fotos en la lista y sin N+1 (con cursores falsos, sin BD)."""
import asyncio
import random
from collections import defaultdict

import pytest
from fastapi import HTTPException

from services import goals, pending
from services.crypto import encrypt_str, encrypt_float
from services.suggest import suggest_category, _normalize_tipo


# ── B3: equivalencia contra la implementación anterior ───────────────────────

def _suggest_category_old(history, importe):
    """Copia literal de la implementación previa (coste H por llamada)."""
    groups = defaultdict(list)
    for r in history:
        tipo = _normalize_tipo(r.get("tipo"))
        concepto = str(r.get("concepto", "") or "").strip()
        if not concepto:
            continue
        try:
            amt = abs(float(r.get("importe", 0) or 0))
        except (TypeError, ValueError):
            continue
        groups[(tipo, concepto)].append(amt)
    if not groups:
        return None
    total = sum(len(v) for v in groups.values())
    best_key, best_score = None, -1.0
    for key, amounts in groups.items():
        freq = len(amounts) / total
        mean = sum(amounts) / len(amounts)
        rel_diff = abs(mean - importe) / (mean + 1e-6)
        closeness = 1.0 / (1.0 + rel_diff)
        score = 0.6 * freq + 0.4 * closeness
        if score > best_score:
            best_score, best_key = score, key
    if best_key is None:
        return None
    return {"tipo": best_key[0], "concepto": best_key[1], "confidence": round(best_score, 2)}


def _random_history(rng, n):
    tipos = ["Gasto Variable", "GASTO FIJO", "Ingreso", "ingresos", "", None, "otro"]
    conceptos = ["Super", "Café", " Café ", "Gasolina", "Netflix", "", None, "Nómina", "Ocio"]
    out = []
    for _ in range(n):
        imp = rng.choice([rng.uniform(0.5, 200), -rng.uniform(1, 50), 0, None, "x", "12.5", 10.0, 10.0])
        out.append({"tipo": rng.choice(tipos), "concepto": rng.choice(conceptos), "importe": imp})
    return out


@pytest.mark.parametrize("seed", range(25))
def test_suggest_category_equivale_a_la_anterior(seed):
    rng = random.Random(seed)
    hist = _random_history(rng, rng.choice([0, 1, 5, 60, 400]))
    for imp in [0.0, 1.0, 10.0, 12.5, 49.99, 100.0, 250.0, 1e6] + [rng.uniform(0, 300) for _ in range(10)]:
        assert suggest_category(hist, imp) == _suggest_category_old(hist, imp)


class _Cur:
    """Cursor falso que responde por contenido del SQL y cuenta consultas."""
    def __init__(self, responses):
        self.responses, self.executed, self._rows = responses, [], []

    def execute(self, sql, params=None):
        self.executed.append(sql)
        for key, rows in self.responses.items():
            if key in sql:
                self._rows = rows
                return
        raise AssertionError(f"consulta inesperada: {sql[:80]}")

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None


def _patch_db(monkeypatch, mod, cur):
    class _Ctx:
        def __enter__(self): return cur
        def __exit__(self, *a): return False

    async def _run(fn, *a, **k):
        return fn(*a, **k)

    monkeypatch.setattr(mod, "db_cursor", lambda: _Ctx())
    monkeypatch.setattr(mod, "run_in_thread", _run)


def test_get_pending_equivale_a_la_version_anterior(monkeypatch):
    rng = random.Random(7)
    hist_rows, hist_plain = [], []
    for i, h in enumerate(_random_history(rng, 300)):
        try:
            imp = float(h["importe"])
        except (TypeError, ValueError):
            continue
        concepto = h["concepto"] or "Varios"
        hist_rows.append({"id": i, "tipo": h["tipo"] or "", "concepto_enc": encrypt_str(concepto),
                          "importe_enc": encrypt_float(imp)})
        hist_plain.append({"tipo": h["tipo"] or "", "concepto": concepto, "importe": imp})
    pend = [{"id": i, "importe": None, "importe_enc": encrypt_float(round(rng.uniform(1, 150), 2)),
             "fecha": "2026-01-01", "comercio_enc": None, "comercio_hmac": None, "fuente": "atajo"}
            for i in range(40)]
    cur = _Cur({"FROM pending_transactions": pend, "FROM transactions": hist_rows})
    _patch_db(monkeypatch, pending, cur)
    got = asyncio.run(pending.get_pending("a@b.com"))
    assert len(got) == 40
    for item in got:
        exp = _suggest_category_old(hist_plain, item["importe"])
        assert item["suggested"] == ({**exp, "origen": "historial"} if exp else None)
        assert set(item) == {"id", "importe", "fecha", "comercio", "fuente", "suggested"}
    assert sum("FROM transactions" in q for q in cur.executed) == 1  # historial leído una vez


def test_get_pending_con_reglas_no_toca_el_historial(monkeypatch):
    tag = b"\x01" * 32
    pend = [{"id": 1, "importe": None, "importe_enc": encrypt_float(5.0), "fecha": "2026-01-01",
             "comercio_enc": encrypt_str("Mercadona"), "comercio_hmac": tag, "fuente": "wallet"}]
    rules = [{"comercio_hmac": tag, "tipo": "Gasto Variable", "concepto_enc": encrypt_str("Super")}]
    cur = _Cur({"FROM pending_transactions": pend, "FROM merchant_rules": rules})
    _patch_db(monkeypatch, pending, cur)
    got = asyncio.run(pending.get_pending("a@b.com"))
    assert got[0]["suggested"] == {"tipo": "Gasto Variable", "concepto": "Super",
                                   "confidence": 1.0, "origen": "comercio"}
    assert not any("FROM transactions" in q for q in cur.executed)


# ── B1: metas sin fotos y sin N+1 ────────────────────────────────────────────

def _goal_cursor(n_goals):
    from decimal import Decimal
    gl = [{"id": i, "nombre": f"m{i}", "objetivo": Decimal("100"), "emoji": "x", "imagen_url": None,
           "fecha": None, "created_by": "a@b.com"} for i in range(1, n_goals + 1)]
    mem = [{"goal_id": g["id"], "user_email": "a@b.com", "name": "A"} for g in gl]
    con = [{"goal_id": g["id"], "id": g["id"] * 10, "user_email": "a@b.com", "name": "A",
            "importe": Decimal("10.10"), "fecha": "2026-01-01", "tiene_foto": g["id"] % 2 == 0} for g in gl]
    con += [{"goal_id": 1, "id": 999, "user_email": "a@b.com", "name": "A",
             "importe": Decimal("0.20"), "fecha": "2026-01-02", "tiene_foto": False}]
    return _Cur({"FROM savings_goals g": gl, "FROM savings_goal_members m": mem,
                 "FROM savings_goal_contributions c": con})


@pytest.mark.parametrize("n", [1, 5, 25])
def test_lista_de_metas_tres_consultas_y_sin_foto(monkeypatch, n):
    cur = _goal_cursor(n)
    _patch_db(monkeypatch, goals, cur)
    res = asyncio.run(goals.get_goals_for_user("a@b.com"))
    assert len(cur.executed) == 3  # independiente del nº de metas
    assert len(res) == n
    for g in res:
        for c in g["contributions"]:
            assert "foto" not in c and isinstance(c["tiene_foto"], bool)
    assert res[0]["ahorrado"] == 10.3  # 10.10 + 0.20 exacto (Decimal)
    assert not any("c.foto," in q or "c.foto\n" in q or q.rstrip().endswith("c.foto") for q in cur.executed)


def test_get_goal_no_recarga_todas(monkeypatch):
    cur = _goal_cursor(3)
    _patch_db(monkeypatch, goals, cur)
    asyncio.run(goals.get_goal(1, "a@b.com"))
    assert len(cur.executed) == 3 and "g.id = %s" in cur.executed[0]


def test_get_goal_inexistente_404(monkeypatch):
    cur = _Cur({"FROM savings_goals g": []})
    _patch_db(monkeypatch, goals, cur)
    with pytest.raises(HTTPException) as e:
        asyncio.run(goals.get_goal(1, "a@b.com"))
    assert e.value.status_code == 404 and len(cur.executed) == 1


def test_foto_ruta_exige_jwt(client):
    assert client.get("/api/goals/1/contributions/1/foto").status_code in (401, 403)


def _fake_foto(monkeypatch, calls):
    import main

    async def fake(goal_id, cid, email):
        calls.append((goal_id, cid, email))
        if cid == 404:
            raise HTTPException(status_code=404, detail="Foto no encontrada")
        return "data:image/jpeg;base64,AAAA"
    monkeypatch.setattr(main, "get_contribution_foto", fake)


def test_foto_ruta_responde_y_404_uniforme(client, auth_headers, monkeypatch):
    calls = []
    _fake_foto(monkeypatch, calls)
    r = client.get("/api/goals/3/contributions/5/foto", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"foto": "data:image/jpeg;base64,AAAA"}
    assert calls == [(3, 5, "test@example.com")]
    assert client.get("/api/goals/3/contributions/404/foto", headers=auth_headers).status_code == 404


def test_foto_ruta_fija_su_propio_cache_control(monkeypatch):
    import main
    _fake_foto(monkeypatch, [])
    resp = asyncio.run(main.contribution_foto_endpoint(3, 5, "a@b.com"))
    assert resp.headers["cache-control"] == "private, max-age=3600"


@pytest.mark.xfail(reason="SecurityHeadersMiddleware (Backend A) fuerza no-store en todo /api/* y pisa el "
                          "Cache-Control de la ruta; debe respetar uno ya presente", strict=False)
def test_foto_ruta_cache_control_de_extremo_a_extremo(client, auth_headers, monkeypatch):
    _fake_foto(monkeypatch, [])
    r = client.get("/api/goals/3/contributions/5/foto", headers=auth_headers)
    assert r.headers["cache-control"] == "private, max-age=3600"


def test_contribution_foto_no_miembro_o_sin_foto_404(monkeypatch):
    for row in (None, {"foto": None}, {"foto": ""}):
        _patch_db(monkeypatch, goals, _Cur({"FROM savings_goal_contributions c": [row] if row else []}))
        with pytest.raises(HTTPException) as e:
            asyncio.run(goals.get_contribution_foto(1, 1, "a@b.com"))
        assert e.value.status_code == 404


# ── B2: gzip ─────────────────────────────────────────────────────────────────

def test_gzip_finance_grande_si_y_health_pequeno_no(client, auth_headers, monkeypatch):
    import main
    big = {"configured": True, "transactions": [{"concepto": "Supermercado", "importe": 12.5, "i": i}
                                                 for i in range(2000)]}

    async def fake(email, year=None):
        return big
    monkeypatch.setattr(main, "get_finance_data", fake)
    origin = main.origins[0]
    h = {**auth_headers, "Accept-Encoding": "gzip", "Origin": origin}
    r = client.get("/api/finance", headers=h)
    assert r.status_code == 200 and r.headers["content-encoding"] == "gzip"
    assert r.headers["access-control-allow-origin"] == origin  # CORS sigue en la respuesta comprimida
    assert r.json() == big  # httpx descomprime
    r2 = client.get("/api/health", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in r2.headers
    r3 = client.get("/api/finance", headers={**auth_headers, "Accept-Encoding": "identity"})
    assert "content-encoding" not in r3.headers


def test_sse_no_se_comprime_y_llega_en_streaming():
    import main

    async def go():
        sent = asyncio.Queue()
        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
                 "path": "/api/events", "raw_path": b"/api/events", "query_string": b"", "root_path": "",
                 "scheme": "http", "server": ("test", 80), "client": ("1.2.3.4", 1),
                 "headers": [(b"accept-encoding", b"gzip"), (b"host", b"test")]}

        async def receive():
            await asyncio.sleep(3600)

        async def send(msg):
            await sent.put(msg)

        task = asyncio.create_task(main.app(scope, receive, send))
        try:
            start = await asyncio.wait_for(sent.get(), 3)
            hdrs = {k.lower(): v for k, v in start["headers"]}
            assert b"content-encoding" not in hdrs
            assert hdrs[b"content-type"].startswith(b"text/event-stream")
            first = await asyncio.wait_for(sent.get(), 3)
            assert first["body"] == b"event: ping\ndata: connected\n\n"  # sin buffer, en claro
            await main._broadcast()
            ev = await asyncio.wait_for(sent.get(), 3)
            assert ev["body"] == b"event: update\ndata: data_updated\n\n"
        finally:
            task.cancel()
            try:
                await task
            except BaseException:
                pass
    asyncio.run(go())
