"""Cifrado simétrico de datos en reposo (AES-256-GCM).

Objetivo: que quien navegue la base de datos directamente (panel de Supabase,
credenciales de BD filtradas, etc.) NO pueda leer el importe ni la categoría
de las transacciones — solo el backend, que tiene la clave, puede descifrarlos
para servírselos al usuario dueño de esos datos.

Esto es cifrado reversible, no un hash: un hash no se puede deshacer nunca.

La clave vive en la variable de entorno DB_ENCRYPTION_KEY (32 bytes en
base64) — nunca en el código ni en la base de datos. Generar una nueva:

    python -c "import os, base64; print(base64.b64encode(os.urandom(32)).decode())"

Cada cifrado usa un nonce aleatorio de 12 bytes (AES-GCM estándar), así que
el mismo valor en claro produce un ciphertext distinto cada vez — más seguro,
pero significa que ya no se puede agrupar/comparar por igualdad en SQL sobre
estas columnas. La agregación (sumas, top categorías, etc.) se hace en Python
después de descifrar, no en la base de datos.
"""
import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE_LEN = 12


class EncryptionNotConfigured(RuntimeError):
    pass


_key: bytes | None = None


def _get_key() -> bytes:
    global _key
    if _key is None:
        raw = os.getenv("DB_ENCRYPTION_KEY", "")
        if not raw:
            raise EncryptionNotConfigured(
                "DB_ENCRYPTION_KEY no está configurada. Genera una con: "
                "python -c \"import os, base64; print(base64.b64encode(os.urandom(32)).decode())\""
            )
        try:
            key = base64.b64decode(raw)
        except Exception as e:
            raise EncryptionNotConfigured(f"DB_ENCRYPTION_KEY no es base64 válido: {e}")
        if len(key) != 32:
            raise EncryptionNotConfigured(
                f"DB_ENCRYPTION_KEY debe decodificar a 32 bytes (AES-256), tiene {len(key)}"
            )
        _key = key
    return _key


def encrypt_str(plaintext: str) -> bytes:
    """Cifra un string. Devuelve nonce(12) + ciphertext, listo para guardar en BYTEA."""
    aesgcm = AESGCM(_get_key())
    nonce = os.urandom(_NONCE_LEN)
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return nonce + ct


def decrypt_str(blob: bytes) -> str:
    aesgcm = AESGCM(_get_key())
    nonce, ct = bytes(blob[:_NONCE_LEN]), bytes(blob[_NONCE_LEN:])
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")


def encrypt_float(value: float) -> bytes:
    """Cifra un importe. Se serializa con repr() para no perder precisión decimal."""
    return encrypt_str(repr(float(value)))


def decrypt_float(blob: bytes) -> float:
    return float(decrypt_str(blob))
