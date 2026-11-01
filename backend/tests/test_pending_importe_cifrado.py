"""Importe de pendientes cifrado: pruebas sin BD real (FakeDB de test_wallet)."""
import pytest

from services import crypto, pending as pending_mod
from test_wallet import EMAIL, db, broadcasts, post  # noqa: F401  (fixtures)


def test_alta_guarda_enc_y_hmac_sin_claro(post, db, broadcasts):
    r = post({"importe": 34.5, "comercio": "Mercadona", "fuente": "wallet"})
    assert r.status_code == 200 and r.json()["importe"] == 34.5
    row = db.pending[0]
    assert row["importe"] is None
    assert crypto.decrypt_float(row["importe_enc"]) == 34.5
    assert row["importe_hmac"] == pending_mod.importe_tag(34.5)


def test_get_categorize_y_borrado(client, post, db, broadcasts, auth_headers):
    pid = post({"importe": 12.3, "comercio": "Bar"}).json()["id"]
    assert client.get("/api/pending", headers=auth_headers).json()[0]["importe"] == 12.3
    r = client.post(f"/api/pending/{pid}/categorize", headers=auth_headers,
                    json={"tipo": "Gasto Variable", "concepto": "Cañas"})
    assert r.status_code == 200
    assert crypto.decrypt_float(db.transactions[0]["importe_enc"]) == 12.3
    assert db.pending == []


def test_antiguo_solo_claro_se_lee_y_categoriza(client, db, auth_headers):
    db.pending.append({"id": 7, "user_email": EMAIL, "importe": 20.0, "importe_enc": None,
                       "importe_hmac": None, "fecha": "2026-07-01", "comercio_enc": None,
                       "comercio_hmac": None, "fuente": None, "id_externo_hmac": None,
                       "created_at": db.now})
    assert client.get("/api/pending", headers=auth_headers).json()[0]["importe"] == 20.0
    assert client.post("/api/pending/7/categorize", headers=auth_headers,
                       json={"tipo": "Gasto Variable", "concepto": "X"}).status_code == 200
    assert crypto.decrypt_float(db.transactions[0]["importe_enc"]) == 20.0


def test_fila_ilegible_no_da_500(client, db, auth_headers, caplog):
    db.pending.append({"id": 8, "user_email": EMAIL, "importe": None, "importe_enc": b"\x00" * 40,
                       "importe_hmac": None, "fecha": "2026-07-01", "comercio_enc": None,
                       "comercio_hmac": None, "fuente": None, "id_externo_hmac": None,
                       "created_at": db.now})
    with caplog.at_level("WARNING"):
        r = client.get("/api/pending", headers=auth_headers)
    assert r.status_code == 200 and r.json() == []
    assert "id=8" in caplog.text
    assert client.post("/api/pending/8/categorize", headers=auth_headers,
                       json={"tipo": "Gasto Variable", "concepto": "X"}).status_code == 422
    assert db.pending  # no se pierde: se puede descartar
    assert client.delete("/api/pending/8", headers=auth_headers).status_code == 200


def test_dedup_importe_usa_hmac(post, db, broadcasts):
    a = post({"importe": 5, "comercio": "Zara"}).json()
    b = post({"importe": 5.0, "comercio": "zara"}).json()
    c = post({"importe": 5.01, "comercio": "Zara"}).json()
    assert b["estado"] == "duplicada" and b["id"] == a["id"] and b["importe"] == 5.0
    assert c["estado"] == "pendiente"
    assert all("importe = " not in q for q in db.sql)
