import logging
from decimal import Decimal

from fastapi import HTTPException
from .db import db_cursor, run_in_thread
from .suggest import suggest_category
from .crypto import (encrypt_str, encrypt_float, decrypt_str, decrypt_float, decrypt_transaction,
                     hmac_tag, EncryptionNotConfigured)
from .wallet import normalize_merchant
from . import legacy_plain
from .importes import validar_importe, redondear_importe

_log = logging.getLogger(__name__)


def ensure_wallet_schema():
    """Migración ADITIVA e idempotente para el Atajo de Cartera (Apple Pay):
    comercio cifrado + HMAC, fuente e id externo (HMAC) en los pendientes, y la
    tabla de reglas aprendidas por comercio. No borra ni modifica datos."""
    with db_cursor() as cur:
        cur.execute("ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS comercio_enc BYTEA")
        cur.execute("ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS comercio_hmac BYTEA")
        cur.execute("ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS fuente TEXT")
        cur.execute("ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS id_externo_hmac BYTEA")
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_pending_user_created "
            "ON pending_transactions(user_email, created_at DESC)"
        )
        cur.execute("""
            CREATE TABLE IF NOT EXISTS merchant_rules (
                user_email    TEXT REFERENCES users(email) ON DELETE CASCADE,
                comercio_hmac BYTEA,
                tipo          TEXT,
                concepto_enc  BYTEA,
                hits          INT NOT NULL DEFAULT 1,
                updated_at    TIMESTAMPTZ DEFAULT now(),
                PRIMARY KEY (user_email, comercio_hmac)
            )
        """)
        cur.execute("ALTER TABLE public.merchant_rules ENABLE ROW LEVEL SECURITY")


def ensure_pending_importe_schema():
    """Migración ADITIVA e idempotente: el importe de los pendientes se guarda
    cifrado (importe_enc) con una huella HMAC (importe_hmac) para el dedup. La
    columna en claro `importe` pasa a admitir NULL (las filas nuevas la dejan
    vacía); no se borra ni se modifica ningún dato."""
    with db_cursor() as cur:
        cur.execute("ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS importe_enc BYTEA")
        cur.execute("ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS importe_hmac BYTEA")
        cur.execute("ALTER TABLE pending_transactions ALTER COLUMN importe DROP NOT NULL")


def backfill_pending_importe() -> int:
    """Cifra el importe de los pendientes antiguos (importe_enc NULL) a partir de
    la columna en claro, SIN tocarla. Idempotente y a prueba de fallos: nunca
    rompe el arranque ni registra importes (solo contadores). Devuelve cuántos
    pendientes ha cifrado."""
    done = 0
    try:
        with db_cursor() as cur:
            cur.execute(
                "SELECT id, importe FROM pending_transactions "
                "WHERE importe_enc IS NULL AND importe IS NOT NULL"
            )
            rows = cur.fetchall()
            for r in rows:
                try:
                    imp = redondear_importe(r["importe"])
                    cur.execute(
                        "UPDATE pending_transactions SET importe_enc = %s, importe_hmac = %s "
                        "WHERE id = %s AND importe_enc IS NULL",
                        (encrypt_float(imp), importe_tag(imp), r["id"]),
                    )
                    done += 1
                except EncryptionNotConfigured:
                    raise
                except Exception as e:
                    _log.warning("Backfill de pendientes: fila id=%s omitida (%s)", r["id"], type(e).__name__)
    except Exception as e:
        _log.warning("Backfill de importes pendientes no completado (%s)", type(e).__name__)
    return done


# ── Helpers ───────────────────────────────────────────────────────────────────

def merchant_tag(comercio: str | None) -> bytes | None:
    """HMAC del comercio normalizado, o None si no queda nada tras normalizar."""
    norm = normalize_merchant(comercio or "")
    return hmac_tag("comercio:" + norm) if norm else None


def importe_tag(importe) -> bytes:
    """HMAC del importe normalizado a céntimos (entero), para el dedup por igualdad."""
    cents = int((Decimal(str(redondear_importe(importe))) * 100).to_integral_value())
    return hmac_tag(f"importe:{cents}")


def read_importe(row) -> float | None:
    """Importe de un pendiente: importe_enc si existe; si es NULL (pendiente antiguo
    sin migrar) la columna en claro. None si no se puede leer (se registra solo el
    id, nunca el valor)."""
    enc = row.get("importe_enc")
    if enc is not None:
        try:
            return float(decrypt_float(bytes(enc)))
        except EncryptionNotConfigured:
            raise
        except Exception as e:
            _log.warning("No se pudo descifrar el importe del pendiente id=%s (%s)",
                         row.get("id"), type(e).__name__)
            return None
    plain = row.get("importe")
    if plain is None:
        return None
    try:
        return float(plain)
    except (TypeError, ValueError):
        return None


def id_externo_tag(id_externo: str | None) -> bytes | None:
    return hmac_tag("id_externo:" + id_externo) if id_externo else None


def _decrypt_or_none(blob) -> str | None:
    if blob is None:
        return None
    try:
        return decrypt_str(bytes(blob))
    except Exception:
        return None  # fila indescifrable (otra clave): se trata como sin comercio


def _decrypt_history(rows) -> list[dict]:
    out = []
    for h in rows:
        dec = decrypt_transaction(h["concepto_enc"], h["importe_enc"], h["id"])
        if dec is None:
            continue  # fila indescifrable: se omite (ya registrada en el log)
        out.append({"tipo": h["tipo"], "concepto": dec[0], "importe": dec[1]})
    return out


def _fetch_history(cur, email: str) -> list[dict]:
    cur.execute(
        "SELECT id, tipo, concepto_enc, importe_enc FROM transactions WHERE user_email = %s",
        (email,),
    )
    return _decrypt_history(cur.fetchall())


def _rule_to_suggestion(rule) -> dict | None:
    concepto = _decrypt_or_none(rule.get("concepto_enc"))
    if not concepto:
        return None
    return {"tipo": rule["tipo"], "concepto": concepto, "confidence": 1.0, "origen": "comercio"}


# ── Crear ─────────────────────────────────────────────────────────────────────

async def create_pending(email: str, importe: float, fecha: str | None = None,
                         fuente: str | None = None) -> dict:
    importe = redondear_importe(importe)
    imp_enc, imp_tag = encrypt_float(importe), importe_tag(importe)

    def _q():
        with db_cursor() as cur:
            if fecha:
                cur.execute(
                    "INSERT INTO pending_transactions (user_email, importe_enc, importe_hmac, fecha, fuente) "
                    "VALUES (%s, %s, %s, %s::date, %s) RETURNING id, fecha::text",
                    (email, imp_enc, imp_tag, fecha, fuente),
                )
            else:
                cur.execute(
                    "INSERT INTO pending_transactions (user_email, importe_enc, importe_hmac, fuente) "
                    "VALUES (%s, %s, %s, %s) RETURNING id, fecha::text",
                    (email, imp_enc, imp_tag, fuente),
                )
            return cur.fetchone()
    row = dict(await run_in_thread(_q))
    row["importe"] = importe
    return row


async def create_pending_dedup(email: str, importe: float, fecha: str, comercio: str | None,
                                id_externo: str | None, fuente: str = "manual") -> dict:
    """Crea un pendiente (Cartera/Apple Pay o manual), salvo que sea un duplicado:
      - mismo id_externo (HMAC) del mismo usuario en las últimas 24 h, o
      - mismo importe y mismo comercio (HMAC) creado hace < 2 min (reintentos
        del Atajo mientras Render despierta). Esta segunda regla solo se aplica
        si hay comercio o la fuente es "wallet": dos pendientes manuales sin
        comercio y con el mismo importe (dos cafés) son legítimos.
    Devuelve {"id", "importe", "fecha", "comercio", "duplicada", "sugerencia"}.
    Un advisory lock por usuario serializa las peticiones simultáneas para que
    dos reintentos paralelos no creen dos filas."""
    c_hmac = merchant_tag(comercio)
    ide_hmac = id_externo_tag(id_externo)
    comercio_enc = encrypt_str(comercio) if comercio else None
    dedup_reciente = c_hmac is not None or fuente == "wallet"
    importe = redondear_importe(importe)
    imp_enc, imp_tag = encrypt_float(importe), importe_tag(importe)

    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 42))", (email,))
            cur.execute(
                """SELECT id, importe, importe_enc, fecha::text, comercio_enc FROM pending_transactions
                   WHERE user_email = %s AND (
                         (%s::bytea IS NOT NULL AND id_externo_hmac = %s::bytea
                          AND created_at > now() - interval '24 hours')
                      OR (%s AND importe_hmac = %s::bytea
                          AND comercio_hmac IS NOT DISTINCT FROM %s::bytea
                          AND created_at > now() - interval '2 minutes'))
                   ORDER BY id DESC LIMIT 1""",
                (email, ide_hmac, ide_hmac, dedup_reciente, imp_tag, c_hmac),
            )
            dup = cur.fetchone()
            if dup:
                row, duplicada = dict(dup), True
                row["comercio"] = _decrypt_or_none(row.pop("comercio_enc", None))
                leido = read_importe(row)
                row["importe"] = importe if leido is None else leido
            else:
                cur.execute(
                    """INSERT INTO pending_transactions
                         (user_email, importe_enc, importe_hmac, fecha, comercio_enc, comercio_hmac,
                          fuente, id_externo_hmac)
                       VALUES (%s, %s, %s, %s::date, %s, %s, %s, %s)
                       RETURNING id, fecha::text""",
                    (email, imp_enc, imp_tag, fecha, comercio_enc, c_hmac, fuente, ide_hmac),
                )
                row, duplicada = dict(cur.fetchone()), False
                row["importe"] = importe
                row["comercio"] = comercio

            # Sugerencia: a) regla aprendida por comercio; b) historial.
            sugerencia = None
            if c_hmac is not None:
                cur.execute(
                    "SELECT tipo, concepto_enc FROM merchant_rules WHERE user_email = %s AND comercio_hmac = %s",
                    (email, c_hmac),
                )
                rule = cur.fetchone()
                if rule:
                    sugerencia = _rule_to_suggestion(rule)
            if sugerencia is None:
                hist = _fetch_history(cur, email)
                s = suggest_category(hist, float(row["importe"]))
                if s:
                    sugerencia = {**s, "origen": "historial"}
            return row, duplicada, sugerencia

    row, duplicada, sugerencia = await run_in_thread(_q)
    return {
        "id": int(row["id"]),
        "importe": float(row["importe"]),
        "fecha": row["fecha"],
        "comercio": row["comercio"],
        "duplicada": duplicada,
        "sugerencia": sugerencia,
    }


# ── Listar ────────────────────────────────────────────────────────────────────

async def get_pending(email: str) -> list:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT id, importe, importe_enc, fecha::text, comercio_enc, comercio_hmac, fuente "
                "FROM pending_transactions WHERE user_email = %s ORDER BY created_at ASC",
                (email,),
            )
            pending = cur.fetchall()
            # Historial del usuario para sugerir categoría (una sola query)
            cur.execute(
                "SELECT id, tipo, concepto_enc, importe_enc FROM transactions WHERE user_email = %s",
                (email,),
            )
            history = cur.fetchall()
            tags = list({bytes(p["comercio_hmac"]) for p in pending if p.get("comercio_hmac")})
            rules = []
            if tags:
                cur.execute(
                    "SELECT comercio_hmac, tipo, concepto_enc FROM merchant_rules "
                    "WHERE user_email = %s AND comercio_hmac = ANY(%s)",
                    (email, tags),
                )
                rules = cur.fetchall()
            return pending, history, rules

    pending, history, rules = await run_in_thread(_q)
    history = _decrypt_history(history)
    rules_by_tag = {bytes(r["comercio_hmac"]): r for r in rules}

    result = []
    for r in pending:
        importe = read_importe(r)
        if importe is None:
            continue  # importe ilegible: se omite (ya registrado el id); se puede descartar por id
        item = {
            "id": r["id"],
            "importe": importe,
            "fecha": r["fecha"],
            "comercio": _decrypt_or_none(r.get("comercio_enc")),
            "fuente": r.get("fuente"),
        }
        suggested = None
        tag = r.get("comercio_hmac")
        if tag and bytes(tag) in rules_by_tag:
            suggested = _rule_to_suggestion(rules_by_tag[bytes(tag)])
        if suggested is None:
            try:
                s = suggest_category(history, float(item["importe"]))
                suggested = {**s, "origen": "historial"} if s else None
            except (TypeError, ValueError):
                suggested = None
        item["suggested"] = suggested
        result.append(item)
    return result


# ── Categorizar / descartar ───────────────────────────────────────────────────

async def categorize_pending(pending_id: int, email: str, tipo: str, concepto: str,
                             recordar: bool = True, comentario: str | None = None) -> dict:
    """Mueve una transacción pendiente a la tabla transactions con su fecha original.
    Si el pendiente tiene comercio y `recordar`, crea/actualiza la regla aprendida."""
    concepto_enc = encrypt_str(concepto)

    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT id, importe, importe_enc, fecha, comercio_hmac FROM pending_transactions "
                "WHERE id = %s AND user_email = %s",
                (pending_id, email),
            )
            row = cur.fetchone()
            if not row:
                return None
            # Mismo tope y redondeo que el alta directa: un pendiente antiguo
            # (anterior al tope) podría desbordar `importe NUMERIC(10,2)` de PROD.
            try:
                leido = read_importe(row)
                if leido is None:
                    raise HTTPException(status_code=422,
                                        detail="El importe de este pendiente no se puede leer; descártalo")
                importe = validar_importe(leido)
            except ValueError:
                raise HTTPException(status_code=422,
                                    detail="El importe debe ser mayor que 0 y no superar 1.000.000")
            importe_enc = encrypt_float(importe)
            if legacy_plain.enabled():
                # TEMPORAL (B2, hasta la fase 3 de MIGRACION_QA_A_PROD.md): en PROD
                # concepto/importe en claro son NOT NULL sin default. Mismo valor
                # que lo cifrado; nunca se leen.
                cur.execute(
                    "INSERT INTO transactions (user_email, fecha, tipo, concepto_enc, importe_enc, comentario, "
                    "concepto, importe) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, fecha::text",
                    (email, row["fecha"], tipo, concepto_enc, importe_enc, comentario,
                     concepto, importe),
                )
            else:
                cur.execute(
                    "INSERT INTO transactions (user_email, fecha, tipo, concepto_enc, importe_enc, comentario) "
                    "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, fecha::text",
                    (email, row["fecha"], tipo, concepto_enc, importe_enc, comentario),
                )
            tx = cur.fetchone()
            c_hmac = row.get("comercio_hmac")
            if recordar and c_hmac:
                cur.execute(
                    """INSERT INTO merchant_rules (user_email, comercio_hmac, tipo, concepto_enc, hits, updated_at)
                       VALUES (%s, %s, %s, %s, 1, now())
                       ON CONFLICT (user_email, comercio_hmac) DO UPDATE SET
                           tipo = EXCLUDED.tipo, concepto_enc = EXCLUDED.concepto_enc,
                           hits = merchant_rules.hits + 1, updated_at = now()""",
                    (email, bytes(c_hmac), tipo, concepto_enc),
                )
            cur.execute(
                "DELETE FROM pending_transactions WHERE id = %s AND user_email = %s",
                (pending_id, email),
            )
            return dict(tx)
    row = await run_in_thread(_q)
    if not row:
        raise HTTPException(status_code=404, detail="Transacción pendiente no encontrada")
    return row


async def delete_pending(pending_id: int, email: str) -> dict:
    """Descarta un pendiente del propio usuario (p. ej. un pago rechazado)."""
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "DELETE FROM pending_transactions WHERE id = %s AND user_email = %s RETURNING id",
                (pending_id, email),
            )
            return cur.fetchone()
    row = await run_in_thread(_q)
    if not row:
        raise HTTPException(status_code=404, detail="Transacción pendiente no encontrada")
    return {"status": "ok", "id": int(row["id"])}
