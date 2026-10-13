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
import hashlib
import hmac
import logging
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_NONCE_LEN = 12

_log = logging.getLogger("uvicorn.error")


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


def decrypt_transaction(concepto_enc, importe_enc, row_id) -> tuple[str, float] | None:
    """Descifra (concepto, importe) de una fila de `transactions`.

    Tolerante: si la fila no se puede descifrar (InvalidTag porque se cifró con
    otra DB_ENCRYPTION_KEY, blob truncado/NULL, importe no numérico...) devuelve
    None y registra un warning con el id de la fila — nunca el contenido ni la
    clave — para que una fila corrupta no tumbe la respuesta entera.
    Si la clave no está configurada sí se propaga el error (fallo global).
    """
    try:
        return decrypt_str(bytes(concepto_enc)), decrypt_float(bytes(importe_enc))
    except EncryptionNotConfigured:
        raise
    except Exception as e:
        _log.warning(
            "No se pudo descifrar la transacción id=%s (%s); se omite de la respuesta",
            row_id, type(e).__name__,
        )
        return None


# ── HMAC para comparar por igualdad sin guardar el texto en claro ─────────────
#
# El comercio de los pendientes y de las reglas aprendidas va cifrado con
# AES-GCM (nonce aleatorio), así que no se puede buscar por igualdad en SQL.
# Para eso se guarda además un HMAC-SHA256 con una SUBCLAVE derivada de
# DB_ENCRYPTION_KEY vía HKDF (la clave maestra no se reutiliza tal cual para
# otro fin). Sin la clave, el tag no permite recuperar ni comprobar el texto.
# Si DB_ENCRYPTION_KEY cambia, los tags antiguos dejan de coincidir (las
# reglas aprendidas se "olvidan", no se rompe nada).

_HMAC_INFO = b"control-gastos/hmac-tag/v1"
_hmac_cache: tuple[bytes, bytes] | None = None  # (clave maestra, subclave)


def _get_hmac_key() -> bytes:
    global _hmac_cache
    master = _get_key()
    if _hmac_cache is None or _hmac_cache[0] != master:
        sub = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_HMAC_INFO).derive(master)
        _hmac_cache = (master, sub)
    return _hmac_cache[1]


def hmac_tag(texto: str) -> bytes:
    """HMAC-SHA256 (32 bytes) de `texto` con la subclave derivada. Determinista."""
    return hmac.new(_get_hmac_key(), texto.encode("utf-8"), hashlib.sha256).digest()
