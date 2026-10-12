import base64
import os

import pytest
from cryptography.exceptions import InvalidTag

from services import crypto


def test_roundtrip_str():
    assert crypto.decrypt_str(crypto.encrypt_str("Supermercado ñ €")) == "Supermercado ñ €"


def test_roundtrip_float_precision():
    for v in (0.0, 12.34, -5.5, 1234567.89, 0.1 + 0.2):
        assert crypto.decrypt_float(crypto.encrypt_float(v)) == v


def test_nonce_distinto_y_ciphertext_distinto():
    a, b = crypto.encrypt_str("igual"), crypto.encrypt_str("igual")
    assert a != b
    assert a[:12] != b[:12]


def test_no_contiene_texto_en_claro():
    assert b"secreto" not in crypto.encrypt_str("secreto")


def test_decrypt_acepta_memoryview():
    blob = crypto.encrypt_str("hola")
    assert crypto.decrypt_str(memoryview(blob)) == "hola"


def test_manipulado_falla():
    blob = bytearray(crypto.encrypt_str("hola"))
    blob[-1] ^= 1
    with pytest.raises(InvalidTag):
        crypto.decrypt_str(bytes(blob))


@pytest.fixture
def fresh_key(monkeypatch):
    monkeypatch.setattr(crypto, "_key", None)
    yield monkeypatch
    monkeypatch.setattr(crypto, "_key", None)


def test_sin_clave(fresh_key):
    fresh_key.delenv("DB_ENCRYPTION_KEY", raising=False)
    with pytest.raises(crypto.EncryptionNotConfigured):
        crypto.encrypt_str("x")


def test_clave_longitud_invalida(fresh_key):
    fresh_key.setenv("DB_ENCRYPTION_KEY", base64.b64encode(b"corta").decode())
    with pytest.raises(crypto.EncryptionNotConfigured, match="32 bytes"):
        crypto.encrypt_str("x")


def test_clave_no_base64(fresh_key):
    fresh_key.setenv("DB_ENCRYPTION_KEY", "###no-es-base64###")
    with pytest.raises(crypto.EncryptionNotConfigured):
        crypto.encrypt_str("x")


def test_otra_clave_no_descifra(fresh_key):
    blob = crypto.encrypt_str("dato")
    fresh_key.setattr(crypto, "_key", None)
    fresh_key.setenv("DB_ENCRYPTION_KEY", base64.b64encode(os.urandom(32)).decode())
    with pytest.raises(InvalidTag):
        crypto.decrypt_str(blob)
