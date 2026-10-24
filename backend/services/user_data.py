"""Datos propios de cada usuario guardados en el servidor: categorías
personalizadas (`user_categories`) y preferencias (`user_prefs`).

Seguridad:
- El usuario sale SIEMPRE del JWT; toda consulta filtra por user_email.
- El nombre de la categoría y el JSON de prefs van cifrados (AES-GCM,
  services/crypto.py). La unicidad se comprueba con un HMAC del nombre
  normalizado (no hay texto en claro en la BD).
- Nunca se registran en logs nombres ni contenidos: solo ids y `kind`.

La lógica va separada del acceso a BD (clase `_PgRepo`) para poder probarla
sin base de datos real.
"""
import json
import logging
import re
import unicodedata
from fastapi import HTTPException

from .crypto import encrypt_str, decrypt_str, hmac_tag, EncryptionNotConfigured
from .db import db_cursor

_log = logging.getLogger("uvicorn.error")

TIPOS = ("Gasto Variable", "Gasto Fijo", "Ingreso")
PREF_KINDS = ("settings", "budgets", "hidden_categories", "tour")
CONCEPTO_MAX = 40
EMOJI_MAX = 16
MAX_CATEGORIES = 200
MAX_IMPORT_ITEMS = 200
PREFS_MAX_BYTES = 64 * 1024

_BAD_CATS = ("Cc", "Cf", "Cs")  # control, formato/invisibles, sustitutos sueltos
_SPACES_RE = re.compile(r"\s+")


class Duplicate(Exception):
    """Ya existe esa categoría (user_email, tipo, hmac)."""


class LimitReached(Exception):
    """El usuario ya tiene MAX_CATEGORIES categorías."""


# ── Esquema ───────────────────────────────────────────────────────────────────

def ensure_user_data_schema():
    """Migración ADITIVA e idempotente (solo CREATE ... IF NOT EXISTS)."""
    with db_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_categories (
                id            BIGSERIAL PRIMARY KEY,
                user_email    TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                tipo          TEXT NOT NULL CHECK (tipo IN ('Gasto Variable', 'Gasto Fijo', 'Ingreso')),
                concepto_enc  BYTEA NOT NULL,
                concepto_hmac BYTEA NOT NULL,
                emoji         TEXT NOT NULL DEFAULT '',
                created_at    TIMESTAMPTZ DEFAULT now(),
                UNIQUE (user_email, tipo, concepto_hmac)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_prefs (
                user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                kind       TEXT NOT NULL,
                data_enc   BYTEA NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT now(),
                PRIMARY KEY (user_email, kind)
            )
        """)
        cur.execute("ALTER TABLE public.user_categories ENABLE ROW LEVEL SECURITY")
        cur.execute("ALTER TABLE public.user_prefs ENABLE ROW LEVEL SECURITY")


# ── Acceso a BD (todas las consultas filtran por user_email) ──────────────────

class _PgRepo:
    def list_cats(self, email):
        with db_cursor() as cur:
            cur.execute(
                "SELECT id, tipo, concepto_enc, emoji FROM user_categories "
                "WHERE user_email = %s", (email,))
            return cur.fetchall()

    def count_cats(self, email):
        with db_cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM user_categories WHERE user_email = %s", (email,))
            return int(cur.fetchone()["n"])

    def get_cat(self, email, cat_id):
        with db_cursor() as cur:
            cur.execute(
                "SELECT id, tipo, concepto_enc, emoji FROM user_categories "
                "WHERE id = %s AND user_email = %s", (cat_id, email))
            return cur.fetchone()

    def insert_cat(self, email, tipo, enc, hm, emoji, limit=None):
        """Con `limit`, comprueba el tope y inserta en la MISMA transacción bajo un
        bloqueo asesor por usuario: dos altas simultáneas no pueden pasarse."""
        import psycopg2.errors
        try:
            with db_cursor() as cur:
                if limit is not None:
                    cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", ("user_categories|" + email,))
                    cur.execute("SELECT count(*) AS n FROM user_categories WHERE user_email = %s", (email,))
                    if int(cur.fetchone()["n"]) >= limit:
                        raise LimitReached()
                cur.execute(
                    "INSERT INTO user_categories (user_email, tipo, concepto_enc, concepto_hmac, emoji) "
                    "VALUES (%s, %s, %s, %s, %s) RETURNING id, tipo, concepto_enc, emoji",
                    (email, tipo, enc, hm, emoji))
                return cur.fetchone()
        except psycopg2.errors.UniqueViolation:
            raise Duplicate()

    def update_cat(self, email, cat_id, enc, hm, emoji):
        """enc/hm None = no cambiar el nombre; emoji None = no cambiarlo."""
        import psycopg2.errors
        try:
            with db_cursor() as cur:
                cur.execute(
                    "UPDATE user_categories SET "
                    "concepto_enc = COALESCE(%s, concepto_enc), "
                    "concepto_hmac = COALESCE(%s, concepto_hmac), "
                    "emoji = COALESCE(%s, emoji) "
                    "WHERE id = %s AND user_email = %s RETURNING id, tipo, concepto_enc, emoji",
                    (enc, hm, emoji, cat_id, email))
                return cur.fetchone()
        except psycopg2.errors.UniqueViolation:
            raise Duplicate()

    def delete_cat(self, email, cat_id):
        with db_cursor() as cur:
            cur.execute("DELETE FROM user_categories WHERE id = %s AND user_email = %s", (cat_id, email))
            return cur.rowcount > 0

    def list_prefs(self, email):
        with db_cursor() as cur:
            cur.execute("SELECT kind, data_enc, updated_at FROM user_prefs WHERE user_email = %s", (email,))
            return cur.fetchall()

    def get_pref(self, email, kind):
        with db_cursor() as cur:
            cur.execute("SELECT kind, data_enc, updated_at FROM user_prefs WHERE user_email = %s AND kind = %s",
                        (email, kind))
            return cur.fetchone()

    def put_pref(self, email, kind, enc):
        with db_cursor() as cur:
            cur.execute(
                "INSERT INTO user_prefs (user_email, kind, data_enc, updated_at) VALUES (%s, %s, %s, now()) "
                "ON CONFLICT (user_email, kind) DO UPDATE SET data_enc = EXCLUDED.data_enc, updated_at = now() "
                "RETURNING updated_at", (email, kind, enc))
            return cur.fetchone()["updated_at"]


_repo = _PgRepo()  # los tests lo sustituyen por uno en memoria


# ── Validación ────────────────────────────────────────────────────────────────

def normalize_concepto(raw) -> str:
    """NFKC + trim + espacios colapsados (conserva mayúsculas para mostrar)."""
    if not isinstance(raw, str):
        raise ValueError("concepto inválido")
    s = _SPACES_RE.sub(" ", unicodedata.normalize("NFKC", raw)).strip()
    if not (1 <= len(s) <= CONCEPTO_MAX):
        raise ValueError("concepto inválido")
    if any(unicodedata.category(c) in _BAD_CATS for c in s):
        raise ValueError("concepto inválido")
    return s


def _tag(email: str, tipo: str, concepto: str) -> bytes:
    """HMAC de unicidad; incluye el email para que dos usuarios con el mismo
    nombre no compartan hash."""
    return hmac_tag(f"{email}|{tipo}|{concepto.casefold()}")


def clean_emoji(raw) -> str:
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise ValueError("emoji inválido")
    s = raw.strip()
    if len(s) > EMOJI_MAX:
        raise ValueError("emoji inválido")
    for c in s:
        if unicodedata.category(c) in _BAD_CATS and not _emoji_joiner(c):
            raise ValueError("emoji inválido")
    return s


def _emoji_joiner(c: str) -> bool:
    """Excepción legítima del filtro: ZWJ (secuencias como familia) y caracteres etiqueta (banderas)."""
    return c == "\u200d" or "\U000e0020" <= c <= "\U000e007f"


def _validated(tipo, concepto, emoji):
    if tipo not in TIPOS:
        raise ValueError("tipo inválido")
    return tipo, normalize_concepto(concepto), clean_emoji(emoji)


def _item(row):
    try:
        concepto = decrypt_str(bytes(row["concepto_enc"]))
    except EncryptionNotConfigured:
        raise
    except Exception as e:
        _log.warning("No se pudo descifrar la categoría id=%s (%s)", row["id"], type(e).__name__)
        return None
    return {"id": row["id"], "tipo": row["tipo"], "concepto": concepto, "emoji": row["emoji"] or ""}


def _sorted(items):
    items = [i for i in items if i]
    items.sort(key=lambda i: (i["tipo"], i["concepto"].casefold()))
    return items


def _encrypt(s):
    try:
        return encrypt_str(s)
    except UnicodeEncodeError:
        raise _unprocessable("texto inválido")


def _unprocessable(msg):
    return HTTPException(status_code=422, detail=msg)


# ── Categorías ────────────────────────────────────────────────────────────────

def list_categories(email):
    items = [_item(r) for r in _repo.list_cats(email)]
    return {"categories": _sorted(items), "unreadable": sum(1 for i in items if i is None)}


def create_category(email, tipo, concepto, emoji=None):
    try:
        tipo, concepto, emoji = _validated(tipo, concepto, emoji)
    except ValueError as e:
        raise _unprocessable(str(e))
    enc = _encrypt(concepto)
    try:
        row = _repo.insert_cat(email, tipo, enc, _tag(email, tipo, concepto), emoji, limit=MAX_CATEGORIES)
    except LimitReached:
        raise _unprocessable(f"Máximo {MAX_CATEGORIES} categorías")
    except Duplicate:
        raise HTTPException(status_code=409, detail="Esa categoría ya existe")
    return _item(row)


def update_category(email, cat_id, concepto=None, emoji=None):
    enc = hm = None
    if concepto is not None:
        try:
            concepto = normalize_concepto(concepto)
        except ValueError as e:
            raise _unprocessable(str(e))
        cur = _repo.get_cat(email, cat_id)
        if not cur:
            raise HTTPException(status_code=404, detail="Categoría no encontrada")
        enc, hm = _encrypt(concepto), _tag(email, cur["tipo"], concepto)
    if emoji is not None:
        try:
            emoji = clean_emoji(emoji)
        except ValueError as e:
            raise _unprocessable(str(e))
    try:
        row = _repo.update_cat(email, cat_id, enc, hm, emoji)
    except Duplicate:
        raise HTTPException(status_code=409, detail="Esa categoría ya existe")
    if not row:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    return _item(row)


def delete_category(email, cat_id):
    if not _repo.delete_cat(email, cat_id):
        raise HTTPException(status_code=404, detail="Categoría no encontrada")


def import_categories(email, items):
    if not isinstance(items, list) or len(items) > MAX_IMPORT_ITEMS:
        raise _unprocessable(f"Máximo {MAX_IMPORT_ITEMS} elementos")
    existing = {(r["tipo"], bytes(r["hmac"])) for r in _hmacs(email)}
    imported = skipped = 0
    for it in items:
        if not isinstance(it, dict):
            skipped += 1
            continue
        try:
            tipo, concepto, emoji = _validated(it.get("tipo"), it.get("concepto"), it.get("emoji"))
        except ValueError:
            skipped += 1
            continue
        key = (tipo, _tag(email, tipo, concepto))
        if key in existing:
            skipped += 1
            continue
        try:
            _repo.insert_cat(email, tipo, _encrypt(concepto), key[1], emoji, limit=MAX_CATEGORIES)
        except (Duplicate, LimitReached, HTTPException):
            skipped += 1
            continue
        existing.add(key)
        imported += 1
    return {"imported": imported, "skipped": skipped, **list_categories(email)}


def _hmacs(email):
    """(tipo, hmac) de las categorías del usuario, calculado desde los nombres
    descifrados (así no hace falta exponer la columna hmac en el repo)."""
    out = []
    for r in _repo.list_cats(email):
        it = _item(r)
        if it:
            out.append({"tipo": it["tipo"], "hmac": _tag(email, it["tipo"], it["concepto"])})
    return out


# ── Preferencias ──────────────────────────────────────────────────────────────

def _read_pref(row):
    """JSON descifrado de una fila de prefs, o lanza si no se puede leer."""
    return json.loads(decrypt_str(bytes(row["data_enc"])))


def get_prefs(email):
    out = {k: None for k in PREF_KINDS}
    updated = {}
    unreadable = []
    for r in _repo.list_prefs(email):
        if r["kind"] not in PREF_KINDS:
            continue
        try:
            out[r["kind"]] = _read_pref(r)
        except EncryptionNotConfigured:
            raise
        except Exception as e:
            _log.warning("No se pudo descifrar la preferencia kind=%s (%s)", r["kind"], type(e).__name__)
            unreadable.append(r["kind"])
            continue
        updated[r["kind"]] = r["updated_at"].isoformat()
    unreadable.sort()
    return {**out, "updated_at": updated, "unreadable": unreadable}


PREFS_MAX_DEPTH = 32


def _demasiado_hondo(data, limit=PREFS_MAX_DEPTH) -> bool:
    """True si `data` anida listas/dicts más de `limit` niveles. Iterativo a propósito:
    no depende del límite de recursión de Python, que cambia entre versiones
    (con 3.12 json.dumps ya no falla con 5000 niveles)."""
    stack = [(data, 1)]
    while stack:
        item, depth = stack.pop()
        if isinstance(item, (list, dict)):
            if depth > limit:
                return True
            children = item.values() if isinstance(item, dict) else item
            stack.extend((c, depth + 1) for c in children)
    return False


def put_pref(email, kind, data, force=False):
    if kind not in PREF_KINDS:
        raise _unprocessable("kind no permitido")
    if _demasiado_hondo(data):
        raise _unprocessable("JSON inválido")
    try:
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        raw_bytes = raw.encode("utf-8")
    except (TypeError, ValueError, RecursionError):  # UnicodeEncodeError es ValueError
        raise _unprocessable("JSON inválido")
    if len(raw_bytes) > PREFS_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Datos demasiado grandes (máx. 64 KB)")
    if not force:
        row = _repo.get_pref(email, kind)
        if row is not None:
            try:
                _read_pref(row)
            except EncryptionNotConfigured:
                raise
            except Exception:
                # Fila existente que no se puede leer: no se pisa sin ?force=true.
                raise HTTPException(status_code=409, detail="dato_ilegible")
    ts = _repo.put_pref(email, kind, encrypt_str(raw))
    return {"updated_at": ts.isoformat()}
