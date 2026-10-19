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

_SPACES_RE = re.compile(r"\s+")


class Duplicate(Exception):
    """Ya existe esa categoría (user_email, tipo, hmac)."""


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

    def insert_cat(self, email, tipo, enc, hm, emoji):
        import psycopg2.errors
        try:
            with db_cursor() as cur:
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
    if any(unicodedata.category(c) in ("Cc", "Cf") for c in s):
        raise ValueError("concepto inválido")
    return s


def _tag(concepto: str) -> bytes:
    return hmac_tag(concepto.casefold())


def clean_emoji(raw) -> str:
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise ValueError("emoji inválido")
    s = raw.strip()
    if len(s) > EMOJI_MAX:
        raise ValueError("emoji inválido")
    return s


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


def _unprocessable(msg):
    return HTTPException(status_code=422, detail=msg)


# ── Categorías ────────────────────────────────────────────────────────────────

def list_categories(email):
    return {"categories": _sorted(_item(r) for r in _repo.list_cats(email))}


def create_category(email, tipo, concepto, emoji=None):
    try:
        tipo, concepto, emoji = _validated(tipo, concepto, emoji)
    except ValueError as e:
        raise _unprocessable(str(e))
    if _repo.count_cats(email) >= MAX_CATEGORIES:
        raise _unprocessable(f"Máximo {MAX_CATEGORIES} categorías")
    try:
        row = _repo.insert_cat(email, tipo, encrypt_str(concepto), _tag(concepto), emoji)
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
        enc, hm = encrypt_str(concepto), _tag(concepto)
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
    total = len(existing)
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
        key = (tipo, _tag(concepto))
        if key in existing or total >= MAX_CATEGORIES:
            skipped += 1
            continue
        try:
            _repo.insert_cat(email, tipo, encrypt_str(concepto), key[1], emoji)
        except Duplicate:
            skipped += 1
            continue
        existing.add(key)
        total += 1
        imported += 1
    return {"imported": imported, "skipped": skipped, **list_categories(email)}


def _hmacs(email):
    """(tipo, hmac) de las categorías del usuario, calculado desde los nombres
    descifrados (así no hace falta exponer la columna hmac en el repo)."""
    out = []
    for r in _repo.list_cats(email):
        it = _item(r)
        if it:
            out.append({"tipo": it["tipo"], "hmac": _tag(it["concepto"])})
    return out


# ── Preferencias ──────────────────────────────────────────────────────────────

def get_prefs(email):
    out = {k: None for k in PREF_KINDS}
    updated = {}
    for r in _repo.list_prefs(email):
        if r["kind"] not in PREF_KINDS:
            continue
        try:
            out[r["kind"]] = json.loads(decrypt_str(bytes(r["data_enc"])))
        except EncryptionNotConfigured:
            raise
        except Exception as e:
            _log.warning("No se pudo descifrar la preferencia kind=%s (%s)", r["kind"], type(e).__name__)
            continue
        updated[r["kind"]] = r["updated_at"].isoformat()
    return {**out, "updated_at": updated}


def put_pref(email, kind, data):
    if kind not in PREF_KINDS:
        raise _unprocessable("kind no permitido")
    try:
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError):
        raise _unprocessable("JSON inválido")
    if len(raw.encode("utf-8")) > PREFS_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Datos demasiado grandes (máx. 64 KB)")
    ts = _repo.put_pref(email, kind, encrypt_str(raw))
    return {"updated_at": ts.isoformat()}
