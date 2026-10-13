"""Atajo de Cartera / Apple Pay (fase 1, sin IA): parser de importe,
normalización de comercio, fecha por defecto en Madrid, POST /api/pending con
JWT (401/413/422/429, duplicados por reintento e id_externo), sugerencia por
regla vs historial, GET/categorize/DELETE de pendientes y la fecha del
/api/shortcut/pending antiguo. (El Atajo abre la app; no hay token en el Atajo.)

Sin BD real: un FakeDB en memoria emula las consultas que hacen
services/pending.py y services/users.py (se reconocen por su texto SQL)."""
import logging
import time
from datetime import date, datetime, timedelta, timezone

import pytest

from services import crypto, pending as pending_mod, ratelimit, users as users_mod, wallet
from services.wallet import normalize_merchant, parse_fecha, parse_importe

EMAIL = "test@example.com"   # el de auth_headers
OTRO = "otro@example.com"
TOKEN = "tok-wallet-valido-0123456789"


# ── parse_importe ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,esperado", [
    (12.3, 12.3), (12, 12.0), ("12.30", 12.3), ("12,30", 12.3), ("12,30 €", 12.3),
    ("12,30€", 12.3), ("€12.30", 12.3), ("€ 12.30", 12.3), ("EUR 12,30", 12.3),
    ("12,30 EUR", 12.3), ("eur12.30", 12.3), ("12,30 euros", 12.3),
    ("1.234,56 €", 1234.56), ("€1,234.56", 1234.56), ("1 234,56 €", 1234.56),
    ("1 234,56 €", 1234.56), ("12,30 €", 12.3), (" 12,30 € ", 12.3),
    ("1.234", 1234.0), ("1,234", 1234.0), ("0,123", 0.12), ("0.5", 0.5), ("12 345,00", 12345.0),
    ("99 999,99 €", 99999.99),
    ("12", 12.0), ("+12,30 €", 12.3), ("100.000,00 €", 100000.0), ("12.345", 12345.0),
    ("$4.99", 4.99), ("£3,5", 3.5), ("12,3", 12.3), (0.01, 0.01),
])
def test_parse_importe_valido(raw, esperado):
    assert parse_importe(raw) == pytest.approx(esperado)


@pytest.mark.parametrize("raw", [
    None, True, False, "", "   ", "€", "abc", "12,30 abc", "-12,30 €", "−12,30 €", 0, -5, "0",
    "0,00 €", "0,001", float("nan"), float("inf"), "nan", "inf", "Infinity", 1e300, 10**400,
    "100.000,01 €", 100000.01, "1.2.3", "1,2,3", "12,", "12.", "1.234,5,6", "1,23.456,78",
    "12 30", ",5", "1 23,45", "1e5", "0x10", [12], {"v": 1}, "9" * 70, "12..30", "1.23,45",
])
def test_parse_importe_invalido(raw):
    with pytest.raises(ValueError):
        parse_importe(raw)


# ── normalize_merchant ────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,esperado", [
    ("Mercadona", "MERCADONA"),
    ("MERCADONA S.A.", "MERCADONA"),
    ("Mercadona, S.A. 1234", "MERCADONA"),
    ("  mercadona   sa  ", "MERCADONA"),
    ("Cafetería Pepé S.L.", "CAFETERIA PEPE"),
    ("EL CORTE INGLÉS, S.A.", "EL CORTE INGLES"),
    ("Lidl #0456", "LIDL"),
    ("Panadería Nº 3", "PANADERIA NO"),  # NFKD: º → O
    ("Zara Home SLU", "ZARA HOME"),
    ("Café-Bar   Ñandú", "CAFE BAR NANDU"),
    ("7Eleven", "7ELEVEN"),
    ("Sa Pobla Market", "SA POBLA MARKET"),   # "SA" solo se quita al final
    ("1234", ""),
    ("", ""),
    (None, ""),
])
def test_normalize_merchant(raw, esperado):
    assert normalize_merchant(raw) == esperado


def test_mismo_comercio_normalizado_mismo_hmac_y_distinto_si_cambia():
    t = pending_mod.merchant_tag
    assert t("Mercadona S.A. 1234") == t("MERCADONA") == t("mercadona, sa")
    assert t("Mercadona") != t("Lidl")
    assert t("") is None and t(None) is None and t("1234") is None
    assert len(t("Mercadona")) == 32
    assert b"MERCADONA" not in t("Mercadona")


def test_hmac_tag_usa_subclave_distinta_de_la_maestra():
    import hashlib
    import hmac
    with_master = hmac.new(crypto._get_key(), b"x", hashlib.sha256).digest()
    assert crypto.hmac_tag("x") != with_master
    assert crypto.hmac_tag("x") == crypto.hmac_tag("x")


# ── Fecha por defecto: hoy en Europe/Madrid ───────────────────────────────────

@pytest.fixture
def reloj(monkeypatch):
    """Fija "ahora" en 2026-10-11 22:30 UTC = 2026-10-12 00:30 en Madrid (CEST)."""
    t = datetime(2026, 10, 11, 22, 30, tzinfo=timezone.utc)
    monkeypatch.setattr(wallet, "now_utc", lambda: t)
    return t


def test_today_madrid_cruza_medianoche(reloj):
    assert wallet.today_madrid() == date(2026, 10, 12)
    assert parse_fecha(None) == date(2026, 10, 12)
    assert parse_fecha("  ") == date(2026, 10, 12)


def test_today_madrid_invierno(monkeypatch):
    monkeypatch.setattr(wallet, "now_utc", lambda: datetime(2026, 1, 15, 23, 30, tzinfo=timezone.utc))
    assert wallet.today_madrid() == date(2026, 1, 16)  # CET (+1)


@pytest.mark.parametrize("raw,esperado", [
    ("2026-10-05", date(2026, 10, 5)),
    ("2026-10-05T10:30:00", date(2026, 10, 5)),
    ("2026-10-05 10:30", date(2026, 10, 5)),
    ("2026-10-05T23:30:00Z", date(2026, 10, 6)),        # UTC → Madrid, día siguiente
    ("2026-10-05T23:30:00+00:00", date(2026, 10, 6)),
    ("2026-10-05T01:00:00+02:00", date(2026, 10, 5)),
])
def test_parse_fecha_valida(reloj, raw, esperado):
    assert parse_fecha(raw) == esperado


@pytest.mark.parametrize("raw", ["05/10/2026", "2026-13-01", "2026-02-30", "ayer", "1999-12-31",
                                 "2028-01-01", 20261005, "2026-10-05T25:00"])
def test_parse_fecha_invalida(reloj, raw):
    with pytest.raises(ValueError):
        parse_fecha(raw)


# ── FakeDB: emula en memoria las consultas de pending.py / users.py ───────────

class FakeDB:
    def __init__(self):
        self.now = datetime(2026, 10, 12, 10, 0, tzinfo=timezone.utc)
        self.pending: list[dict] = []
        self.transactions: list[dict] = []
        self.rules: dict[tuple, dict] = {}
        self.users = {EMAIL: TOKEN, OTRO: "tok-del-otro-usuario-0123456789"}
        self._seq = 100
        self.sql: list[str] = []

    def next_id(self):
        self._seq += 1
        return self._seq


class FakeCursor:
    def __init__(self, db: FakeDB):
        self.db = db
        self._res: list = []

    def fetchone(self):
        return self._res[0] if self._res else None

    def fetchall(self):
        return list(self._res)

    def execute(self, sql, params=()):
        db = self.db
        q = " ".join(sql.split())
        db.sql.append(q)
        self._res = []
        if q.startswith("SELECT pg_advisory_xact_lock"):
            return
        if q.startswith("SELECT id, importe, fecha::text, comercio_enc FROM pending_transactions"):
            email, ide, _, reciente, importe, chmac = params
            cands = [
                p for p in db.pending if p["user_email"] == email and (
                    (ide is not None and p["id_externo_hmac"] == ide
                     and p["created_at"] > db.now - timedelta(hours=24))
                    or (reciente and round(p["importe"], 2) == round(importe, 2)
                        and p["comercio_hmac"] == chmac
                        and p["created_at"] > db.now - timedelta(minutes=2)))
            ]
            cands.sort(key=lambda p: -p["id"])
            self._res = [{k: cands[0][k] for k in ("id", "importe", "fecha", "comercio_enc")}] if cands else []
            return
        if q.startswith("INSERT INTO pending_transactions") and "comercio_enc" in q:
            email, importe, fecha, cenc, chmac, fuente, ide = params
            row = {"id": db.next_id(), "user_email": email, "importe": round(importe, 2), "fecha": fecha,
                   "comercio_enc": cenc, "comercio_hmac": chmac, "fuente": fuente,
                   "id_externo_hmac": ide, "created_at": db.now}
            db.pending.append(row)
            self._res = [{"id": row["id"], "importe": row["importe"], "fecha": fecha}]
            return
        if q.startswith("INSERT INTO pending_transactions (user_email, importe"):
            if len(params) == 4:
                email, importe, fecha, fuente = params
            else:
                (email, importe, fuente), fecha = params, "2000-01-01"
            row = {"id": db.next_id(), "user_email": email, "importe": importe, "fecha": fecha,
                   "comercio_enc": None, "comercio_hmac": None, "fuente": fuente,
                   "id_externo_hmac": None, "created_at": db.now}
            db.pending.append(row)
            self._res = [{"id": row["id"], "fecha": fecha, "importe": importe}]
            return
        if q.startswith("SELECT tipo, concepto_enc FROM merchant_rules"):
            r = db.rules.get((params[0], bytes(params[1])))
            self._res = [r] if r else []
            return
        if q.startswith("SELECT id, tipo, concepto_enc, importe_enc FROM transactions"):
            self._res = [t for t in db.transactions if t["user_email"] == params[0]]
            return
        if q.startswith("SELECT id, importe, fecha::text, comercio_enc, comercio_hmac, fuente"):
            self._res = sorted((p for p in db.pending if p["user_email"] == params[0]),
                               key=lambda p: (p["created_at"], p["id"]))
            return
        if q.startswith("SELECT comercio_hmac, tipo, concepto_enc FROM merchant_rules"):
            email, tags = params
            self._res = [dict(r, comercio_hmac=k[1]) for k, r in db.rules.items()
                         if k[0] == email and k[1] in tags]
            return
        if q.startswith("SELECT importe, fecha, comercio_hmac FROM pending_transactions"):
            pid, email = params
            self._res = [p for p in db.pending if p["id"] == pid and p["user_email"] == email]
            return
        if q.startswith("INSERT INTO transactions"):
            email, fecha, tipo, cenc, ienc, comentario = params
            t = {"id": db.next_id(), "user_email": email, "fecha": fecha, "tipo": tipo,
                 "concepto_enc": cenc, "importe_enc": ienc, "comentario": comentario}
            db.transactions.append(t)
            self._res = [{"id": t["id"], "fecha": str(fecha)}]
            return
        if q.startswith("INSERT INTO merchant_rules"):
            email, chmac, tipo, cenc = params
            key = (email, bytes(chmac))
            old = db.rules.get(key)
            db.rules[key] = {"tipo": tipo, "concepto_enc": cenc, "hits": (old["hits"] + 1) if old else 1}
            return
        if q.startswith("DELETE FROM pending_transactions WHERE id = %s AND user_email = %s"):
            pid, email = params
            hit = [p for p in db.pending if p["id"] == pid and p["user_email"] == email]
            db.pending = [p for p in db.pending if p not in hit]
            self._res = [{"id": p["id"]} for p in hit]
            return
        if q.startswith("SELECT email FROM users WHERE shortcut_token"):
            self._res = [{"email": e} for e, t in db.users.items() if t == params[0]]
            return
        raise AssertionError(f"SQL no emulado: {q[:80]}")


@pytest.fixture
def db(monkeypatch):
    fdb = FakeDB()

    class _Ctx:
        def __enter__(self):
            return FakeCursor(fdb)

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(pending_mod, "db_cursor", lambda: _Ctx())
    monkeypatch.setattr(users_mod, "db_cursor", lambda: _Ctx())
    return fdb


@pytest.fixture
def broadcasts(monkeypatch):
    import main
    calls = []

    async def fake():
        calls.append(1)
    monkeypatch.setattr(main, "_broadcast", fake)
    return calls


@pytest.fixture
def otro_headers():
    from services.auth import create_jwt
    return {"Authorization": f"Bearer {create_jwt(OTRO)}"}


@pytest.fixture
def post(client, auth_headers):
    def _post(body=None, headers=None, **kw):
        return client.post("/api/pending", json=body, headers=headers or auth_headers, **kw)
    return _post


def _tx(email, tipo, concepto, importe):
    return {"id": 1, "user_email": email, "tipo": tipo,
            "concepto_enc": crypto.encrypt_str(concepto), "importe_enc": crypto.encrypt_float(importe)}


# ── POST /api/pending: alta, auth, compatibilidad ─────────────────────────────

def test_post_pending_wallet(post, db, broadcasts):
    r = post({"importe": "12,30 €", "comercio": "Mercadona", "fuente": "wallet"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert set(j) == {"estado", "id", "importe", "comercio", "fecha", "sugerencia"}
    assert j["estado"] == "pendiente" and j["importe"] == 12.3 and j["comercio"] == "Mercadona"
    assert isinstance(j["id"], int)
    assert broadcasts == [1]
    row = db.pending[0]
    assert row["user_email"] == EMAIL and row["fuente"] == "wallet"
    # El comercio NO se guarda en claro: cifrado + HMAC del nombre normalizado
    assert b"Mercadona" not in row["comercio_enc"] and crypto.decrypt_str(row["comercio_enc"]) == "Mercadona"
    assert row["comercio_hmac"] == pending_mod.merchant_tag("MERCADONA S.A.")


def test_post_pending_body_antiguo_compatible(post, db, broadcasts):
    r = post({"importe": 7.5, "fecha": "2026-10-01"})
    assert r.status_code == 200
    j = r.json()
    assert j["estado"] == "pendiente" and j["importe"] == 7.5 and j["fecha"] == "2026-10-01"
    assert j["comercio"] is None and j["sugerencia"] is None
    assert db.pending[0]["fuente"] == "manual"


def test_post_pending_requiere_jwt(client, db):
    assert client.post("/api/pending", json={"importe": 5}).status_code == 401
    r = client.post("/api/pending", json={"importe": 5, "token": TOKEN},
                    headers={"Authorization": f"Bearer {TOKEN}"})  # el shortcut_token NO vale aquí
    assert r.status_code == 401
    assert db.pending == []


def test_endpoints_con_token_descartados(client):
    import main
    rutas = {getattr(r, "path", "") for r in main.app.routes}
    assert "/api/shortcut/transaction" not in rutas
    assert "/api/shortcut/token/rotate" not in rutas


# ── 413 / 422 ─────────────────────────────────────────────────────────────────

def test_post_pending_body_grande_413(post, db):
    r = post({"importe": 5, "comercio": "x" * 5000})
    assert r.status_code == 413 and db.pending == []


@pytest.mark.parametrize("body", [
    {"importe": "abc"}, {"importe": -3}, {"importe": 0}, {"importe": "100.000,01"}, {},
    {"importe": None}, {"importe": "nan"}, {"importe": True},
])
def test_post_pending_importe_invalido_422_generico(post, db, broadcasts, body):
    r = post(body)
    assert r.status_code == 422
    assert r.json() == {"detail": "importe inválido"}
    assert db.pending == [] and broadcasts == []


def test_post_pending_fecha_invalida_422(post, db):
    r = post({"importe": 5, "fecha": "05/10/2026"})
    assert r.status_code == 422 and r.json() == {"detail": "fecha inválida"}


@pytest.mark.parametrize("fuente", ["shortcut", "", 1, "WALLET"])
def test_post_pending_fuente_invalida_422(post, db, fuente):
    r = post({"importe": 5, "fuente": fuente})
    assert r.status_code == 422 and r.json() == {"detail": "fuente inválida"}


@pytest.mark.parametrize("raw", [b"no-json", b"[1,2]", b'"texto"', b""])
def test_post_pending_body_no_objeto_422(client, auth_headers, db, raw):
    r = client.post("/api/pending", content=raw,
                    headers={**auth_headers, "Content-Type": "application/json"})
    assert r.status_code == 422 and r.json() == {"detail": "Body inválido"}


def test_post_pending_json_doblemente_codificado(client, auth_headers, db, broadcasts):
    import json
    raw = json.dumps(json.dumps({"importe": "3,40 €", "comercio": "Bar"}))
    r = client.post("/api/pending", content=raw,
                    headers={**auth_headers, "Content-Type": "application/json"})
    assert r.status_code == 200 and r.json()["importe"] == 3.4


def test_post_pending_comercio_strip_recorte_y_vacio(post, db, broadcasts):
    assert post({"importe": 1, "comercio": "  " + "A" * 200 + "  "}).json()["comercio"] == "A" * 120
    assert post({"importe": 2, "comercio": "   "}).json()["comercio"] is None
    assert db.pending[-1]["comercio_enc"] is None and db.pending[-1]["comercio_hmac"] is None
    assert post({"importe": 3, "comercio": 123}).json()["comercio"] is None


def test_post_pending_no_registra_datos_sensibles(post, db, broadcasts, caplog):
    caplog.set_level(logging.DEBUG)
    post({"importe": "77,77 €", "comercio": "ComercioSecreto"})
    post({"importe": "zzz", "comercio": "ComercioSecreto"})
    for secreto in ("ComercioSecreto", "77,77", "77.77"):
        assert secreto not in caplog.text


# ── 429 ───────────────────────────────────────────────────────────────────────

def test_post_pending_rate_limit_por_minuto(post, db, broadcasts, otro_headers):
    for i in range(30):
        assert post({"importe": i + 1}).status_code == 200
    assert post({"importe": 99}).status_code == 429
    # Por usuario: el otro no se ve afectado
    assert post({"importe": 1}, headers=otro_headers).status_code == 200


def test_post_pending_rate_limit_diario(post, db, broadcasts, otro_headers):
    ratelimit._hits[f"pending-day:{EMAIL}"] = [time.monotonic() - 3600] * 300
    assert post({"importe": 1}).status_code == 429 and db.pending == []
    assert post({"importe": 1}, headers=otro_headers).status_code == 200


# ── Duplicados ────────────────────────────────────────────────────────────────

def test_reintento_mismo_importe_y_comercio_es_duplicada(post, db, broadcasts):
    r1 = post({"importe": "12,30 €", "comercio": "Mercadona", "fuente": "wallet"}).json()
    db.now += timedelta(seconds=90)
    r2 = post({"importe": 12.3, "comercio": "MERCADONA S.A.", "fuente": "wallet"}).json()
    assert r2["estado"] == "duplicada" and r2["id"] == r1["id"]
    assert r2["comercio"] == "Mercadona" and r2["importe"] == 12.3
    assert len(db.pending) == 1
    assert broadcasts == [1]  # el duplicado no vuelve a notificar


def test_mismo_importe_pasados_2_min_no_es_duplicada(post, db, broadcasts):
    post({"importe": 12.3, "comercio": "Mercadona"})
    db.now += timedelta(minutes=2, seconds=1)
    assert post({"importe": 12.3, "comercio": "Mercadona"}).json()["estado"] == "pendiente"
    assert len(db.pending) == 2


def test_otro_comercio_u_otro_importe_no_es_duplicada(post, db, broadcasts):
    post({"importe": 12.3, "comercio": "Mercadona"})
    assert post({"importe": 12.3, "comercio": "Lidl"}).json()["estado"] == "pendiente"
    assert post({"importe": 12.31, "comercio": "Mercadona"}).json()["estado"] == "pendiente"
    assert len(db.pending) == 3


def test_manual_sin_comercio_mismo_importe_no_es_duplicada(post, db, broadcasts):
    post({"importe": 2})
    assert post({"importe": 2}).json()["estado"] == "pendiente"
    assert len(db.pending) == 2


def test_wallet_sin_comercio_mismo_importe_es_duplicada(post, db, broadcasts):
    post({"importe": 2, "fuente": "wallet"})
    assert post({"importe": 2, "fuente": "wallet"}).json()["estado"] == "duplicada"


def test_id_externo_duplicado_24h(post, db, broadcasts):
    r1 = post({"importe": 5, "comercio": "Bar", "id_externo": "abc-1"}).json()
    db.now += timedelta(hours=23)
    r2 = post({"importe": 7, "comercio": "Otro", "id_externo": "abc-1"}).json()
    assert r2["estado"] == "duplicada" and r2["id"] == r1["id"] and r2["importe"] == 5.0
    db.now += timedelta(hours=2)  # > 24 h desde el primero
    assert post({"importe": 7, "comercio": "Otro", "id_externo": "abc-1"}).json()["estado"] == "pendiente"
    assert b"abc-1" not in db.pending[0]["id_externo_hmac"]


def test_duplicados_son_por_usuario(post, db, broadcasts, otro_headers):
    post({"importe": 5, "comercio": "Bar", "id_externo": "x"})
    r = post({"importe": 5, "comercio": "Bar", "id_externo": "x"}, headers=otro_headers).json()
    assert r["estado"] == "pendiente"


# ── Fecha por defecto en los endpoints ────────────────────────────────────────

def test_post_pending_fecha_por_defecto_hoy_en_madrid(post, db, broadcasts, reloj):
    assert post({"importe": 5}).json()["fecha"] == "2026-10-12"  # 22:30 UTC del 11 = 00:30 del 12
    assert db.pending[0]["fecha"] == "2026-10-12"


def test_post_pending_fecha_recibida(post, db, broadcasts, reloj):
    assert post({"importe": 5, "fecha": "2026-10-01"}).json()["fecha"] == "2026-10-01"
    assert post({"importe": 6, "fecha": "2026-10-01T23:30:00Z"}).json()["fecha"] == "2026-10-02"


def test_shortcut_pending_antiguo_usa_fecha_o_hoy_madrid(client, db, broadcasts, reloj):
    r = client.post("/api/shortcut/pending", json={"token": TOKEN, "importe": 5})
    assert r.status_code == 200 and r.json()["fecha"] == "2026-10-12"
    r = client.post("/api/shortcut/pending", json={"token": TOKEN, "importe": 5, "fecha": "2026-09-30"})
    assert r.json()["fecha"] == "2026-09-30"
    # Formato desconocido: se tolera (compatibilidad) y se usa hoy en Madrid
    r = client.post("/api/shortcut/pending", json={"token": TOKEN, "importe": 5, "fecha": "30 sept"})
    assert r.status_code == 200 and r.json()["fecha"] == "2026-10-12"
    assert all(p["fuente"] == "atajo" for p in db.pending)


# ── Sugerencia: regla por comercio vs historial ───────────────────────────────

def test_sin_historial_ni_regla(post, db, broadcasts):
    assert post({"importe": "12,30", "comercio": "Mercadona"}).json()["sugerencia"] is None


def test_sugerencia_por_historial(post, db, broadcasts):
    db.transactions.append(_tx(EMAIL, "Gasto Variable", "Ocio", 12.0))
    db.transactions.append(_tx(OTRO, "Gasto Variable", "NoEsMio", 12.0))
    j = post({"importe": 12.3, "comercio": "Cine"}).json()
    assert j["sugerencia"] == {"tipo": "Gasto Variable", "concepto": "Ocio", "origen": "historial"}


def test_sugerencia_por_regla_tiene_prioridad(post, db, broadcasts):
    db.transactions.append(_tx(EMAIL, "Gasto Variable", "Ocio", 12.0))
    db.rules[(EMAIL, pending_mod.merchant_tag("Mercadona"))] = {
        "tipo": "Gasto Variable", "concepto_enc": crypto.encrypt_str("Comida"), "hits": 3}
    j = post({"importe": 12.3, "comercio": "MERCADONA, S.A. 0042"}).json()
    assert j["sugerencia"] == {"tipo": "Gasto Variable", "concepto": "Comida", "origen": "comercio"}


def test_regla_de_otro_usuario_no_aplica(post, db, broadcasts):
    db.rules[(OTRO, pending_mod.merchant_tag("Mercadona"))] = {
        "tipo": "Gasto Variable", "concepto_enc": crypto.encrypt_str("Comida"), "hits": 1}
    assert post({"importe": 1, "comercio": "Mercadona"}).json()["sugerencia"] is None


# ── GET /api/pending ──────────────────────────────────────────────────────────

def test_get_pending_con_comercio_fuente_y_origen(client, post, db, broadcasts, auth_headers):
    db.transactions.append(_tx(EMAIL, "Gasto Variable", "Ocio", 12.0))
    db.rules[(EMAIL, pending_mod.merchant_tag("Mercadona"))] = {
        "tipo": "Gasto Variable", "concepto_enc": crypto.encrypt_str("Comida"), "hits": 1}
    post({"importe": 12.3, "comercio": "Mercadona", "fuente": "wallet"})
    post({"importe": 9, "comercio": "Cine", "fuente": "wallet"})
    client.post("/api/shortcut/pending", json={"token": TOKEN, "importe": 4})
    r = client.get("/api/pending", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()
    assert [i["comercio"] for i in items] == ["Mercadona", "Cine", None]
    assert [i["fuente"] for i in items] == ["wallet", "wallet", "atajo"]
    assert items[0]["suggested"] == {"tipo": "Gasto Variable", "concepto": "Comida",
                                     "confidence": 1.0, "origen": "comercio"}
    assert items[1]["suggested"]["origen"] == "historial" and items[1]["suggested"]["concepto"] == "Ocio"
    assert "confidence" in items[1]["suggested"]
    for i in items:
        assert {"id", "importe", "fecha", "suggested", "comercio", "fuente"} <= set(i)
        assert "comercio_enc" not in i and "comercio_hmac" not in i


# ── POST /api/pending/{id}/categorize ─────────────────────────────────────────

def test_categorize_recordar_crea_y_actualiza_regla(client, post, db, broadcasts, auth_headers):
    pid = post({"importe": 12.3, "comercio": "Mercadona"}).json()["id"]
    r = client.post(f"/api/pending/{pid}/categorize", headers=auth_headers,
                    json={"tipo": "Gasto Variable", "concepto": "Comida"})
    assert r.status_code == 200
    key = (EMAIL, pending_mod.merchant_tag("Mercadona"))
    assert db.rules[key]["hits"] == 1 and crypto.decrypt_str(db.rules[key]["concepto_enc"]) == "Comida"
    assert db.pending == [] and len(db.transactions) == 1 and db.transactions[0]["comentario"] is None

    # Siguiente compra en el mismo comercio → sugerencia por regla
    db.now += timedelta(minutes=5)
    j = post({"importe": 30, "comercio": "Mercadona SA"}).json()
    assert j["sugerencia"]["origen"] == "comercio" and j["sugerencia"]["concepto"] == "Comida"

    # Se recategoriza: la regla se actualiza y suma hits; el comentario se guarda
    client.post(f"/api/pending/{j['id']}/categorize", headers=auth_headers,
                json={"tipo": "Gasto Fijo", "concepto": "Supermercado", "comentario": "  semanal  "})
    assert db.rules[key]["hits"] == 2 and db.rules[key]["tipo"] == "Gasto Fijo"
    assert crypto.decrypt_str(db.rules[key]["concepto_enc"]) == "Supermercado"
    assert db.transactions[-1]["comentario"] == "semanal"


def test_categorize_sin_recordar_no_crea_regla(client, post, db, broadcasts, auth_headers):
    pid = post({"importe": 12.3, "comercio": "Mercadona"}).json()["id"]
    r = client.post(f"/api/pending/{pid}/categorize", headers=auth_headers,
                    json={"tipo": "Gasto Variable", "concepto": "Comida", "recordar": False})
    assert r.status_code == 200 and db.rules == {}


def test_categorize_sin_comercio_no_crea_regla(client, post, db, broadcasts, auth_headers):
    pid = post({"importe": 12.3}).json()["id"]
    client.post(f"/api/pending/{pid}/categorize", headers=auth_headers,
                json={"tipo": "Gasto Variable", "concepto": "Comida"})
    assert db.rules == {} and len(db.transactions) == 1


def test_categorize_formato_antiguo_compatible(client, post, db, broadcasts, auth_headers):
    pid = post({"importe": 3}).json()["id"]
    r = client.post(f"/api/pending/{pid}/categorize", headers=auth_headers,
                    json={"tipo": "Gasto Variable", "concepto": "Café"})
    assert r.status_code == 200 and set(r.json()) == {"id", "fecha"}


def test_categorize_comentario_largo_422(client, post, db, broadcasts, auth_headers):
    pid = post({"importe": 3}).json()["id"]
    r = client.post(f"/api/pending/{pid}/categorize", headers=auth_headers,
                    json={"tipo": "Gasto Variable", "concepto": "Café", "comentario": "x" * 501})
    assert r.status_code == 422 and db.transactions == []


def test_categorize_ajeno_404(client, post, db, broadcasts, auth_headers, otro_headers):
    pid = post({"importe": 3, "comercio": "Bar"}, headers=otro_headers).json()["id"]
    r = client.post(f"/api/pending/{pid}/categorize", headers=auth_headers,
                    json={"tipo": "Gasto Variable", "concepto": "Café"})
    assert r.status_code == 404 and len(db.pending) == 1 and db.rules == {}


# ── DELETE /api/pending/{id} ──────────────────────────────────────────────────

def test_delete_pending_propio(client, post, db, broadcasts, auth_headers):
    pid = post({"importe": 3}).json()["id"]
    broadcasts.clear()
    r = client.delete(f"/api/pending/{pid}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"status": "ok", "id": pid}
    assert db.pending == [] and broadcasts == [1]
    assert client.delete(f"/api/pending/{pid}", headers=auth_headers).status_code == 404


def test_delete_pending_ajeno_404(client, post, db, broadcasts, auth_headers, otro_headers):
    pid = post({"importe": 3}, headers=otro_headers).json()["id"]
    broadcasts.clear()
    r = client.delete(f"/api/pending/{pid}", headers=auth_headers)
    assert r.status_code == 404 and len(db.pending) == 1 and broadcasts == []


def test_delete_pending_requiere_jwt(client, db):
    assert client.delete("/api/pending/1").status_code == 401
