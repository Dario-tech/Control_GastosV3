"""Categorías y prefs por usuario: aislamiento, cifrado en reposo, límites.
Sin BD real: el acceso a datos (`user_data._repo`) se sustituye por uno en
memoria que guarda EXACTAMENTE lo que iría a las columnas (bytes cifrados)."""
import json
import logging
from datetime import datetime, timezone

import pytest

from fastapi import HTTPException

from services import user_data
from services.auth import create_jwt

A, B = "a@example.com", "b@example.com"


class MemRepo:
    def __init__(self):
        self.cats = {}      # id -> dict(user_email, tipo, concepto_enc, concepto_hmac, emoji)
        self.prefs = {}     # (email, kind) -> (data_enc, updated_at)
        self._id = 0

    def _row(self, r):
        return {"id": r["id"], "tipo": r["tipo"], "concepto_enc": r["concepto_enc"], "emoji": r["emoji"]}

    def list_cats(self, email):
        return [self._row(r) for r in self.cats.values() if r["user_email"] == email]

    def count_cats(self, email):
        return len(self.list_cats(email))

    def get_cat(self, email, cat_id):
        r = self.cats.get(cat_id)
        return self._row(r) if r and r["user_email"] == email else None

    def _dup(self, email, tipo, hm, ignore=None):
        return any(r["user_email"] == email and r["tipo"] == tipo and r["concepto_hmac"] == hm and r["id"] != ignore
                   for r in self.cats.values())

    def insert_cat(self, email, tipo, enc, hm, emoji, limit=None):
        if limit is not None and self.count_cats(email) >= limit:
            raise user_data.LimitReached()
        if self._dup(email, tipo, hm):
            raise user_data.Duplicate()
        self._id += 1
        self.cats[self._id] = dict(id=self._id, user_email=email, tipo=tipo, concepto_enc=enc,
                                   concepto_hmac=hm, emoji=emoji)
        return self._row(self.cats[self._id])

    def update_cat(self, email, cat_id, enc, hm, emoji):
        r = self.cats.get(cat_id)
        if not r or r["user_email"] != email:
            return None
        if hm is not None:
            if self._dup(email, r["tipo"], hm, ignore=cat_id):
                raise user_data.Duplicate()
            r["concepto_enc"], r["concepto_hmac"] = enc, hm
        if emoji is not None:
            r["emoji"] = emoji
        return self._row(r)

    def delete_cat(self, email, cat_id):
        r = self.cats.get(cat_id)
        if r and r["user_email"] == email:
            del self.cats[cat_id]
            return True
        return False

    def list_prefs(self, email):
        return [{"kind": k, "data_enc": v[0], "updated_at": v[1]}
                for (e, k), v in self.prefs.items() if e == email]

    def get_pref(self, email, kind):
        v = self.prefs.get((email, kind))
        return {"kind": kind, "data_enc": v[0], "updated_at": v[1]} if v else None

    def put_pref(self, email, kind, enc):
        ts = datetime.now(timezone.utc)
        self.prefs[(email, kind)] = (enc, ts)
        return ts


@pytest.fixture
def repo(monkeypatch):
    r = MemRepo()
    monkeypatch.setattr(user_data, "_repo", r)
    return r


def H(email):
    return {"Authorization": f"Bearer {create_jwt(email)}"}


def mk(client, email, concepto="Café", tipo="Gasto Variable", **kw):
    return client.post("/api/categories", json={"tipo": tipo, "concepto": concepto, **kw}, headers=H(email))


# ── Auth ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,url,body", [
    ("get", "/api/categories", None),
    ("post", "/api/categories", {"tipo": "Ingreso", "concepto": "x"}),
    ("patch", "/api/categories/1", {"emoji": "x"}),
    ("delete", "/api/categories/1", None),
    ("post", "/api/categories/import", {"items": []}),
    ("get", "/api/prefs", None),
    ("put", "/api/prefs/settings", {"data": {}}),
])
def test_sin_token_401(client, repo, method, url, body):
    r = getattr(client, method)(url, **({"json": body} if body is not None else {}))
    assert r.status_code == 401


# ── Categorías: CRUD básico ───────────────────────────────────────────────────

def test_crud_basico(client, repo):
    r = mk(client, A, "  Café   con  leche ", emoji="☕")
    assert r.status_code == 201
    item = r.json()
    assert item == {"id": item["id"], "tipo": "Gasto Variable", "concepto": "Café con leche", "emoji": "☕"}
    assert mk(client, A, "Alquiler", tipo="Gasto Fijo").status_code == 201
    assert mk(client, A, "Beca", tipo="Ingreso").status_code == 201
    lst = client.get("/api/categories", headers=H(A)).json()["categories"]
    assert [(c["tipo"], c["concepto"]) for c in lst] == [
        ("Gasto Fijo", "Alquiler"), ("Gasto Variable", "Café con leche"), ("Ingreso", "Beca")]
    p = client.patch(f"/api/categories/{item['id']}", json={"concepto": "Té", "emoji": "🍵"}, headers=H(A))
    assert p.status_code == 200 and p.json()["concepto"] == "Té" and p.json()["emoji"] == "🍵"
    assert client.delete(f"/api/categories/{item['id']}", headers=H(A)).status_code == 204
    assert client.delete(f"/api/categories/{item['id']}", headers=H(A)).status_code == 404


def test_validaciones_422(client, repo):
    assert mk(client, A, tipo="Otro").status_code == 422
    assert mk(client, A, "   ").status_code == 422
    assert mk(client, A, "x" * 41).status_code == 422
    assert mk(client, A, "x" * 40).status_code == 201
    assert mk(client, A, "ok", emoji="e" * 17).status_code == 422
    assert mk(client, A, "con\x00nulo").status_code == 422
    assert client.post("/api/categories", json={"tipo": "Ingreso"}, headers=H(A)).status_code == 422


def test_unicidad_y_normalizacion_409(client, repo):
    assert mk(client, A, "Café").status_code == 201
    assert mk(client, A, "café ").status_code == 409
    assert mk(client, A, "CAFÉ").status_code == 409
    assert mk(client, A, "Ca fé").status_code == 201
    # mismo nombre en otro tipo: permitido
    assert mk(client, A, "Café", tipo="Ingreso").status_code == 201
    # NFKC: "ｃａｆé" (ancho completo) == "café"
    assert mk(client, A, "ｃａｆé").status_code == 409
    # y otro usuario puede tener la suya
    assert mk(client, B, "Café").status_code == 201


def test_patch_conflicto_409(client, repo):
    a = mk(client, A, "Uno").json()
    mk(client, A, "Dos")
    assert client.patch(f"/api/categories/{a['id']}", json={"concepto": " dos"}, headers=H(A)).status_code == 409
    # renombrar a sí misma con otra capitalización es válido
    assert client.patch(f"/api/categories/{a['id']}", json={"concepto": "UNO"}, headers=H(A)).status_code == 200


# ── Aislamiento ───────────────────────────────────────────────────────────────

def test_aislamiento_entre_usuarios(client, repo):
    a = mk(client, A, "Secreta", emoji="🔒").json()
    assert client.get("/api/categories", headers=H(B)).json() == {"categories": [], "unreadable": 0}
    # B no puede editar ni borrar la de A: 404 (igual que si no existiera)
    p = client.patch(f"/api/categories/{a['id']}", json={"concepto": "Hack"}, headers=H(B))
    d = client.delete(f"/api/categories/{a['id']}", headers=H(B))
    ghost = client.delete("/api/categories/99999", headers=H(B))
    assert p.status_code == 404 and d.status_code == 404
    assert d.json() == ghost.json()
    # sigue intacta para A
    assert client.get("/api/categories", headers=H(A)).json()["categories"][0]["concepto"] == "Secreta"


def test_import_no_toca_a_otros(client, repo):
    mk(client, A, "Solo A")
    r = client.post("/api/categories/import", json={"items": [{"tipo": "Ingreso", "concepto": "Solo B"}]}, headers=H(B))
    assert [c["concepto"] for c in r.json()["categories"]] == ["Solo B"]
    assert [c["concepto"] for c in client.get("/api/categories", headers=H(A)).json()["categories"]] == ["Solo A"]


def test_prefs_aisladas(client, repo):
    client.put("/api/prefs/budgets", json={"data": {"Comida": 100}}, headers=H(A))
    rb = client.get("/api/prefs", headers=H(B)).json()
    assert rb["budgets"] is None and rb["updated_at"] == {}
    assert client.get("/api/prefs", headers=H(A)).json()["budgets"] == {"Comida": 100}


def test_todas_las_consultas_sql_filtran_por_user_email(monkeypatch):
    """Revisa el SQL real de _PgRepo con un cursor que solo graba."""
    executed = []

    class Cur:
        rowcount = 0
        def execute(self, sql, params=None): executed.append((sql, params))
        def fetchone(self): return {"n": 0, "updated_at": datetime.now(timezone.utc)}
        def fetchall(self): return []

    class Ctx:
        def __enter__(self): return Cur()
        def __exit__(self, *a): return False

    monkeypatch.setattr(user_data, "db_cursor", lambda: Ctx())
    r = user_data._PgRepo()
    r.list_cats(A); r.count_cats(A); r.get_cat(A, 1); r.insert_cat(A, "Ingreso", b"x", b"y", "")
    r.update_cat(A, 1, None, None, "e"); r.delete_cat(A, 1); r.list_prefs(A); r.get_pref(A, "tour"); r.put_pref(A, "tour", b"z")
    assert len(executed) == 9
    for sql, params in executed:
        assert "user_email" in sql, sql
        assert A in params
        assert "FROM categories" not in sql and " categories " not in sql  # nunca la tabla antigua
    for sql, _ in executed:
        if sql.lstrip().startswith(("UPDATE", "DELETE")):
            assert "user_email = %s" in sql.split("WHERE")[1]


# ── Import ────────────────────────────────────────────────────────────────────

def test_import_idempotente_e_invalidos(client, repo):
    items = [
        {"tipo": "Gasto Variable", "concepto": "Cine", "emoji": "🎬"},
        {"tipo": "Gasto Variable", "concepto": " cine"},          # duplicado dentro del lote
        {"tipo": "Ingreso", "concepto": "Extra"},
        {"tipo": "Nada", "concepto": "Mal"},                       # inválido
        {"tipo": "Ingreso", "concepto": ""},                       # inválido
        "basura",                                                  # inválido
    ]
    r1 = client.post("/api/categories/import", json={"items": items}, headers=H(A))
    assert r1.status_code == 200
    j1 = r1.json()
    assert (j1["imported"], j1["skipped"]) == (2, 4)
    assert len(j1["categories"]) == 2
    r2 = client.post("/api/categories/import", json={"items": items}, headers=H(A)).json()
    assert (r2["imported"], r2["skipped"]) == (0, 6)
    assert r2["categories"] == j1["categories"]


def test_import_mas_de_200_items_422(client, repo):
    items = [{"tipo": "Ingreso", "concepto": f"c{i}"} for i in range(201)]
    assert client.post("/api/categories/import", json={"items": items}, headers=H(A)).status_code == 422


def test_tope_200_categorias(client, repo):
    items = [{"tipo": "Ingreso", "concepto": f"c{i}"} for i in range(200)]
    assert client.post("/api/categories/import", json={"items": items}, headers=H(A)).json()["imported"] == 200
    assert mk(client, A, "una mas").status_code == 422
    r = client.post("/api/categories/import", json={"items": [{"tipo": "Ingreso", "concepto": "otra"}]}, headers=H(A))
    assert (r.json()["imported"], r.json()["skipped"]) == (0, 1)
    # otro usuario no se ve afectado
    assert mk(client, B, "libre").status_code == 201


# ── Cifrado en reposo ─────────────────────────────────────────────────────────

def test_nombre_categoria_cifrado_en_bd(client, repo):
    mk(client, A, "NombreSuperSecreto", emoji="🔐")
    (row,) = repo.cats.values()
    assert b"NombreSuperSecreto" not in bytes(row["concepto_enc"])
    assert b"nombresupersecreto" not in bytes(row["concepto_hmac"]).lower()
    assert row["concepto_enc"] != row["concepto_hmac"]
    from services.crypto import decrypt_str
    assert decrypt_str(row["concepto_enc"]) == "NombreSuperSecreto"
    assert "NombreSuperSecreto" not in repr({k: v for k, v in row.items() if k != "concepto_enc"})


def test_prefs_cifradas_en_bd_y_ronda(client, repo):
    data = {"moneda": "EUR", "presupuesto_secreto": 1234.5, "lista": ["ñandú", 1, None]}
    r = client.put("/api/prefs/settings", json={"data": data}, headers=H(A))
    assert r.status_code == 200 and "updated_at" in r.json()
    enc, _ = repo.prefs[(A, "settings")]
    assert b"presupuesto_secreto" not in bytes(enc) and b"1234" not in bytes(enc)
    g = client.get("/api/prefs", headers=H(A)).json()
    assert g["settings"] == data
    assert g["budgets"] is None and g["hidden_categories"] is None and g["tour"] is None
    assert set(g["updated_at"]) == {"settings"}


def test_prefs_upsert_ultimo_gana(client, repo):
    client.put("/api/prefs/hidden_categories", json={"data": ["a"]}, headers=H(A))
    client.put("/api/prefs/hidden_categories", json={"data": ["b", "c"]}, headers=H(A))
    assert client.get("/api/prefs", headers=H(A)).json()["hidden_categories"] == ["b", "c"]
    assert len(repo.prefs) == 1


def test_prefs_kind_invalido_422(client, repo):
    assert client.put("/api/prefs/otro", json={"data": 1}, headers=H(A)).status_code == 422
    assert not repo.prefs


def test_prefs_sin_data_o_json_malo_422(client, repo):
    assert client.put("/api/prefs/tour", json={"x": 1}, headers=H(A)).status_code == 422
    r = client.put("/api/prefs/tour", content=b"{no json", headers={**H(A), "content-type": "application/json"})
    assert r.status_code == 422


def test_prefs_tope_64kb(client, repo):
    ok = {"data": "x" * (64 * 1024 - 2)}   # serializado: justo 64 KB con las comillas
    assert len(json.dumps(ok["data"])) == 64 * 1024
    assert client.put("/api/prefs/settings", json=ok, headers=H(A)).status_code == 200
    big = {"data": "x" * (64 * 1024)}
    assert client.put("/api/prefs/settings", json=big, headers=H(A)).status_code == 413
    huge = {"data": "x" * (300 * 1024)}
    assert client.put("/api/prefs/settings", json=huge, headers=H(A)).status_code == 413


# ── Límite de ritmo y logs ────────────────────────────────────────────────────

def test_rate_limit_escrituras(client, repo):
    codes = [mk(client, A, f"c{i}").status_code for i in range(62)]
    assert codes[:60].count(201) == 60
    assert 429 in codes[60:]
    # otro usuario no se ve afectado
    assert mk(client, B, "libre").status_code == 201


def test_no_se_loguea_contenido(client, repo, caplog):
    caplog.set_level(logging.DEBUG)
    mk(client, A, "NombreNoLoggeable", emoji="🙈")
    mk(client, A, "nombrenologgeable")
    client.put("/api/prefs/settings", json={"data": {"clave": "ValorNoLoggeable"}}, headers=H(A))
    client.get("/api/prefs", headers=H(A))
    client.get("/api/categories", headers=H(A))
    texto = caplog.text.lower()
    assert "nombrenologgeable" not in texto and "valornologgeable" not in texto


def test_fila_corrupta_se_omite_sin_loguear_contenido(client, repo, caplog):
    mk(client, A, "Buena")
    repo.insert_cat(A, "Ingreso", b"basura-no-cifrada-1234567890", b"h", "")
    with caplog.at_level(logging.WARNING):
        lst = client.get("/api/categories", headers=H(A)).json()["categories"]
    assert [c["concepto"] for c in lst] == ["Buena"]
    assert "basura" not in caplog.text


# ── Ronda de seguridad 2: datos ilegibles, tamaños, caracteres, atomicidad ─────

def test_prefs_unreadable_y_put_409(client, repo):
    client.put("/api/prefs/budgets", json={"data": {"a": 1}}, headers=H(A))
    client.put("/api/prefs/tour", json={"data": True}, headers=H(A))
    repo.prefs[(A, "budgets")] = (b"clave-rotada-no-descifra-0123456789", repo.prefs[(A, "budgets")][1])
    g = client.get("/api/prefs", headers=H(A)).json()
    assert g["budgets"] is None and g["unreadable"] == ["budgets"]
    assert g["tour"] is True and "budgets" not in g["updated_at"]
    # sin fila no es "ilegible"; el otro usuario no ve nada
    assert client.get("/api/prefs", headers=H(B)).json()["unreadable"] == []
    # PUT sin force: 409 y no escribe
    before = repo.prefs[(A, "budgets")]
    r = client.put("/api/prefs/budgets", json={"data": {"b": 2}}, headers=H(A))
    assert r.status_code == 409 and r.json() == {"detail": "dato_ilegible"}
    assert repo.prefs[(A, "budgets")] == before
    # con force=true sobrescribe
    assert client.put("/api/prefs/budgets?force=true", json={"data": {"b": 2}}, headers=H(A)).status_code == 200
    g = client.get("/api/prefs", headers=H(A)).json()
    assert g["budgets"] == {"b": 2} and g["unreadable"] == []
    # kind sano o inexistente: PUT normal sigue funcionando
    assert client.put("/api/prefs/settings", json={"data": {}}, headers=H(A)).status_code == 200


def test_categorias_unreadable_cuenta(client, repo):
    mk(client, A, "Buena")
    repo.insert_cat(A, "Ingreso", b"basura-no-cifrada-1234567890", b"h", "")
    repo.insert_cat(A, "Ingreso", b"otra-basura-no-cifrada-123456", b"h2", "")
    j = client.get("/api/categories", headers=H(A)).json()
    assert [c["concepto"] for c in j["categories"]] == ["Buena"] and j["unreadable"] == 2


def _chunks(n, size=8192):
    def gen():
        sent = 0
        while sent < n:
            k = min(size, n - sent)
            sent += k
            yield b"x" * k
    return gen()


@pytest.mark.parametrize("method,url", [
    ("post", "/api/categories"), ("post", "/api/categories/import"),
    ("patch", "/api/categories/1"), ("put", "/api/prefs/settings")])
def test_cuerpo_mayor_128kb_413_incluso_chunked(client, repo, method, url):
    hdr = {**H(A), "content-type": "application/json"}
    r = getattr(client, method)(url, content=b"x" * (129 * 1024), headers=hdr)
    assert r.status_code == 413
    r = getattr(client, method)(url, content=_chunks(300 * 1024), headers=hdr)  # sin Content-Length
    assert r.status_code == 413
    assert not repo.prefs and not repo.cats


def test_middleware_corta_en_flujo(client):
    import asyncio, main
    seen = []

    async def inner(scope, receive, send):
        while True:
            m = await receive()
            seen.append(len(m["body"]))
            if not m.get("more_body"):
                break

    mw = main.BodySizeLimitMiddleware(inner, max_bytes=1000)
    chunks = [{"type": "http.request", "body": b"x" * 400, "more_body": True} for _ in range(100)]
    sent = []

    async def receive():
        return chunks.pop(0)

    async def send(m):
        sent.append(m)

    asyncio.run(mw({"type": "http", "path": "/api/prefs/tour", "headers": []}, receive, send))
    assert sent[0]["status"] == 413 and len(seen) == 2 and len(chunks) == 97  # corta al pasar el límite


def test_otras_rutas_sin_tope_de_middleware(client, auth_headers):
    r = client.post("/api/auth/login", content=b"x" * (200 * 1024), headers={"content-type": "application/json"})
    assert r.status_code != 413


def test_max_length_modelos_422(client, repo):
    assert mk(client, A, "x" * 201).status_code == 422
    assert mk(client, A, "ok", emoji="e" * 65).status_code == 422
    assert client.post("/api/categories", json={"tipo": "t" * 33, "concepto": "x"}, headers=H(A)).status_code == 422
    big = [{"tipo": "Ingreso", "concepto": "c"}] * 201
    assert client.post("/api/categories/import", json={"items": big}, headers=H(A)).status_code == 422
    r = client.post("/api/categories/import", json={"items": [{"tipo": "Ingreso", "concepto": "c" * 201}]}, headers=H(A))
    assert r.status_code == 422


def test_import_items_tipados_elementos_raros_se_omiten(client, repo):
    items = [{"tipo": "Ingreso", "concepto": "Ok"}, 5, None, "x", [1], {"tipo": 3, "concepto": 4}, {"extra": 1}]
    j = client.post("/api/categories/import", json={"items": items}, headers=H(A)).json()
    assert (j["imported"], j["skipped"]) == (1, 6)


def test_json_anidado_extremo_422(client, repo):
    deep = b'{"data":' + b"[" * 50000 + b"]" * 50000 + b"}"
    hdr = {**H(A), "content-type": "application/json"}
    assert client.put("/api/prefs/tour", content=deep, headers=hdr).status_code == 422
    nested = []
    for _ in range(5000):
        nested = [nested]
    with pytest.raises(HTTPException) as e:
        user_data.put_pref(A, "tour", nested)
    assert e.value.status_code == 422
    # cuerpo hondo en un endpoint con modelo pydantic: FastAPI lo traduce a 400 (nunca 500)
    r = client.post("/api/categories", content=b"[" * 50000 + b"]" * 50000, headers=hdr)
    assert r.status_code in (400, 422)


def test_get_prefs_con_json_hondo_en_bd_no_revienta(client, repo):
    from services.crypto import encrypt_str
    repo.prefs[(A, "tour")] = (encrypt_str("[" * 50000 + "]" * 50000), datetime.now(timezone.utc))
    j = client.get("/api/prefs", headers=H(A))
    assert j.status_code == 200 and j.json()["unreadable"] == ["tour"]


@pytest.mark.parametrize("bad", ["\x00", "\u200b", "\u202e", "\x07", "\ud800", "a\udc00"])
def test_emoji_y_nombre_caracteres_raros_422(client, repo, bad):
    assert mk(client, A, "ok", emoji="🙂" + bad).status_code == 422
    assert mk(client, A, "no" + bad).status_code == 422
    assert not repo.cats


def test_emoji_zwj_y_banderas_validos(client, repo):
    for e in ("👨\u200d👩\u200d👧", "❤\ufe0f", "🏴\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f", "1\ufe0f\u20e3"):
        assert mk(client, A, f"c{len(repo.cats)}", emoji=e).status_code == 201, e


def test_prefs_surrogate_suelto_422(client, repo):
    r = client.put("/api/prefs/tour", content='{"data":"\\ud800"}'.encode(), headers={**H(A), "content-type": "application/json"})
    assert r.status_code == 422
    with pytest.raises(HTTPException) as e:
        user_data.put_pref(A, "tour", "\ud800")
    assert e.value.status_code == 422 and not repo.prefs


def test_category_id_fuera_de_rango(client, repo):
    for cid in (0, -1, 2**63, 10**30):
        assert client.delete(f"/api/categories/{cid}", headers=H(A)).status_code in (404, 422)
        assert client.patch(f"/api/categories/{cid}", json={"emoji": "x"}, headers=H(A)).status_code in (404, 422)
    assert client.delete(f"/api/categories/{2**63 - 1}", headers=H(A)).status_code == 404


def test_hmac_incluye_email(client, repo):
    mk(client, A, "Mismo")
    mk(client, B, "Mismo")
    hs = [r["concepto_hmac"] for r in repo.cats.values()]
    assert hs[0] != hs[1]
    from services.crypto import hmac_tag
    assert hs[0] == hmac_tag(f"{A}|Gasto Variable|mismo")
    # mismo nombre en otro tipo, mismo usuario: hash distinto
    mk(client, A, "Mismo", tipo="Ingreso")
    assert len({r["concepto_hmac"] for r in repo.cats.values()}) == 3
    # renombrar conserva la unicidad con el hash con tipo
    c = mk(client, A, "Otro").json()
    assert client.patch(f"/api/categories/{c['id']}", json={"concepto": "MISMO"}, headers=H(A)).status_code == 409


def test_alta_atomica_sql_bloqueo_y_conteo_en_misma_transaccion(monkeypatch):
    executed, txs = [], []

    class Cur:
        def execute(self, sql, params=None): executed.append(sql)
        def fetchone(self): return {"n": 200}
        def fetchall(self): return []

    class Ctx:
        def __enter__(self):
            txs.append(len(executed)); return Cur()
        def __exit__(self, *a): return False

    monkeypatch.setattr(user_data, "db_cursor", lambda: Ctx())
    with pytest.raises(user_data.LimitReached):
        user_data._PgRepo().insert_cat(A, "Ingreso", b"x", b"y", "", limit=200)
    assert len(txs) == 1                                   # una sola transacción
    assert "pg_advisory_xact_lock" in executed[0] and "count(*)" in executed[1]
    assert len(executed) == 2                              # no llegó a insertar


def test_alta_concurrente_no_supera_tope(client, repo):
    import threading
    lock = threading.Lock()
    orig = repo.insert_cat

    def atomic(*a, **k):
        with lock:   # equivale al bloqueo asesor de Postgres
            return orig(*a, **k)
    repo.insert_cat = atomic
    items = [{"tipo": "Ingreso", "concepto": f"c{i}"} for i in range(199)]
    client.post("/api/categories/import", json={"items": items}, headers=H(A))
    res = []
    ts = [threading.Thread(target=lambda i=i: res.append(user_data.create_category_safe(A, i))) for i in range(5)] \
        if hasattr(user_data, "create_category_safe") else []
    assert not ts
    codes = []

    def go(i):
        try:
            user_data.create_category(A, "Ingreso", f"n{i}")
            codes.append(201)
        except HTTPException as e:
            codes.append(e.status_code)
    th = [threading.Thread(target=go, args=(i,)) for i in range(5)]
    [t.start() for t in th]; [t.join() for t in th]
    assert codes.count(201) == 1 and codes.count(422) == 4 and len(repo.cats) == 200


# ── Esquema ───────────────────────────────────────────────────────────────────

def test_schema_y_ensure_aditivos():
    import os, re, inspect
    sql = open(os.path.join(os.path.dirname(os.path.dirname(__file__)), "schema.sql"), encoding="utf-8").read()
    for t in ("user_categories", "user_prefs"):
        assert re.search(rf"CREATE TABLE IF NOT EXISTS {t}\b", sql)
        assert re.search(rf"ALTER TABLE public\.{t}\s+ENABLE ROW LEVEL SECURITY", sql)
    assert "UNIQUE (user_email, tipo, concepto_hmac)" in sql
    src = inspect.getsource(user_data.ensure_user_data_schema)
    assert not re.search(r"\b(DROP|DELETE FROM|UPDATE|TRUNCATE)\b", src)
    import main
    assert "ensure_user_data_schema" in inspect.getsource(main.lifespan)
