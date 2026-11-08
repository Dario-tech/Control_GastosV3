"""Captura de tickets con IA: validación de imagen, normalización, límites, privacidad (sin red)."""
import base64
import logging

import pytest

from services import ticket_scan as ts

JPG = b"\xff\xd8\xff\xe0" + b"0" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"0" * 100


def b64(b):
    return base64.b64encode(b).decode()


# ── imagen ────────────────────────────────────────────────────────────────────

def test_detecta_el_tipo_real_por_los_bytes():
    assert ts.decodificar_imagen(b64(JPG)) == (JPG, "image/jpeg")
    assert ts.decodificar_imagen("data:image/png;base64," + b64(PNG)) == (PNG, "image/png")
    assert ts.decodificar_imagen(b64(WEBP))[1] == "image/webp"


@pytest.mark.parametrize("malo", [
    None, "", 5, "no es base64!!", b64(b"GIF89a" + b"0" * 50), b64(b"%PDF-1.4" + b"0" * 50), b64(b"<svg></svg>"),
    b64(JPG + b"0" * ts.MAX_IMAGE_BYTES),   # demasiado grande
    "A" * (ts.MAX_B64_CHARS + 1),
])
def test_imagenes_rechazadas(malo):
    with pytest.raises(ts.TicketScanError):
        ts.decodificar_imagen(malo)


# ── normalización con los validadores de /api/pending ─────────────────────────

def test_normalizar_valida_cada_campo():
    ok = ts.normalizar(ts._Ticket(es_ticket=True, importe_total=23.456, comercio="  Mercadona   S.A. ", fecha="2025-03-04"))
    assert ok == {"importe": 23.46, "comercio": "Mercadona S.A.", "fecha": "2025-03-04"}
    malo = ts.normalizar(ts._Ticket(es_ticket=True, importe_total=-5, comercio=" ", fecha="04/03/2025"))
    assert malo == {"importe": None, "comercio": None, "fecha": None}
    assert ts.normalizar(ts._Ticket(es_ticket=False, importe_total=10, comercio="X", fecha="2025-01-01")) == \
        {"importe": None, "comercio": None, "fecha": None}
    assert ts.normalizar(ts._Ticket(es_ticket=True, importe_total=10**9))["importe"] is None


# ── endpoint ──────────────────────────────────────────────────────────────────

@pytest.fixture
def con_ia(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-no-real")
    llamadas = []

    async def fake(data, media_type):
        llamadas.append((len(data), media_type))
        return {"importe": 12.5, "comercio": "Bar Pepe", "fecha": "2025-03-04"}
    monkeypatch.setattr(ts, "escanear_ticket", fake)
    return llamadas


def post(client, headers, imagen=None, **kw):
    return client.post("/api/ticket-scan", json={"imagen": imagen if imagen is not None else b64(JPG)}, headers=headers, **kw)


def test_requiere_login(client):
    assert client.post("/api/ticket-scan", json={}).status_code == 401
    assert client.get("/api/ticket-scan/status").status_code == 401


def test_sin_api_key_degrada_con_elegancia(client, auth_headers, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert client.get("/api/ticket-scan/status", headers=auth_headers).json() == {"disponible": False}
    r = post(client, auth_headers)
    assert r.status_code == 503 and "no está disponible" in r.json()["detail"]


def test_propone_sin_guardar_nada(client, auth_headers, con_ia):
    assert client.get("/api/ticket-scan/status", headers=auth_headers).json() == {"disponible": True}
    r = post(client, auth_headers)
    assert r.status_code == 200
    assert r.json() == {"importe": 12.5, "comercio": "Bar Pepe", "fecha": "2025-03-04"}
    assert con_ia == [(len(JPG), "image/jpeg")]


def test_422_para_imagen_mala_sin_llamar_a_la_ia(client, auth_headers, con_ia):
    assert post(client, auth_headers, imagen=b64(b"GIF89a....")).status_code == 422
    assert client.post("/api/ticket-scan", json={}, headers=auth_headers).status_code == 422
    assert client.post("/api/ticket-scan", content=b"no json", headers=auth_headers).status_code == 422
    assert con_ia == []


def test_cuerpo_demasiado_grande_413(client, auth_headers, con_ia):
    r = client.post("/api/ticket-scan", json={"imagen": "A" * 1_600_000}, headers=auth_headers)
    assert r.status_code == 413
    assert con_ia == []


def test_rate_limit_por_usuario(client, auth_headers, con_ia):
    codigos = [post(client, auth_headers).status_code for _ in range(4)]
    assert codigos == [200, 200, 200, 429]


def test_fallo_de_la_ia_da_502_generico(client, auth_headers, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-no-real")

    async def roto(data, media_type):
        raise ts.TicketReadError()
    monkeypatch.setattr(ts, "escanear_ticket", roto)
    r = post(client, auth_headers)
    assert r.status_code == 502 and "sk-" not in r.text


# ── servicio: llamada a la API simulada y privacidad en logs ──────────────────

def _respuesta(ticket: dict | str):
    import json
    texto = ticket if isinstance(ticket, str) else json.dumps(ticket)
    return {"candidates": [{"content": {"parts": [{"text": texto}]}}]}


def test_llama_a_gemini_con_la_imagen_y_valida(monkeypatch):
    import asyncio
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-no-real")
    vistos = []
    monkeypatch.setattr(ts, "_post", lambda p: vistos.append(p) or _respuesta(
        {"es_ticket": True, "importe_total": 9.99, "comercio": "Zara", "fecha": "2025-02-01"}))
    res = asyncio.run(ts.escanear_ticket(JPG, "image/jpeg"))
    assert res == {"importe": 9.99, "comercio": "Zara", "fecha": "2025-02-01"}
    parte = vistos[0]["contents"][0]["parts"][0]["inline_data"]
    assert parte["mime_type"] == "image/jpeg" and parte["data"] == b64(JPG)
    assert vistos[0]["generationConfig"]["responseMimeType"] == "application/json"


def test_clave_en_cabecera_no_en_la_url(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-no-real")
    capt = {}

    class R:
        def raise_for_status(self): pass
        def json(self): return {"ok": 1}

    def fake_post(url, **kw):
        capt.update(url=url, **kw)
        return R()
    monkeypatch.setattr(ts.httpx, "post", fake_post)
    assert ts._post({"a": 1}) == {"ok": 1}
    assert "test-key" not in capt["url"] and capt["headers"]["x-goog-api-key"] == "test-key-no-real"
    assert capt["url"].startswith("https://generativelanguage.googleapis.com/")


def test_no_ticket_es_un_error_de_usuario(monkeypatch):
    import asyncio
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-no-real")
    monkeypatch.setattr(ts, "_post", lambda p: _respuesta({"es_ticket": False}))
    with pytest.raises(ts.TicketScanError):
        asyncio.run(ts.escanear_ticket(JPG, "image/jpeg"))


def test_respuesta_rara_de_gemini_es_fallo_del_servicio(monkeypatch):
    import asyncio
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-no-real")
    monkeypatch.setattr(ts, "_post", lambda p: _respuesta("esto no es json"))
    with pytest.raises(ts.TicketReadError):
        asyncio.run(ts.escanear_ticket(JPG, "image/jpeg"))


def test_logs_sin_imagen_ni_importes(monkeypatch, caplog):
    import asyncio

    def boom(p):
        raise RuntimeError("detalle 77,77 € Mercadona " + b64(JPG))
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-no-real")
    monkeypatch.setattr(ts, "_post", boom)
    caplog.set_level(logging.DEBUG)
    with pytest.raises(ts.TicketReadError):
        asyncio.run(ts.escanear_ticket(JPG, "image/jpeg"))
    assert "RuntimeError" in caplog.text
    for secreto in ("77,77", "Mercadona", b64(JPG)[:20], "test-key"):
        assert secreto not in caplog.text
