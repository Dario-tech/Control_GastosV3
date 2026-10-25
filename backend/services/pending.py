import json

from fastapi import HTTPException
from .db import db_cursor, run_in_thread
from .suggest import suggest_category
from .merchant_dict import clave_marca, match_comercio, suggest_from_dictionary
from .crypto import encrypt_str, encrypt_float, decrypt_str, decrypt_transaction, hmac_tag
from .wallet import normalize_merchant
from . import legacy_plain
from .importes import validar_importe


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


# ── Helpers ───────────────────────────────────────────────────────────────────

def merchant_tag(comercio: str | None) -> bytes | None:
    """HMAC del comercio normalizado, o None si no queda nada tras normalizar."""
    norm = normalize_merchant(comercio or "")
    return hmac_tag("comercio:" + norm) if norm else None


def brand_tag(comercio: str | None) -> bytes | None:
    """HMAC de la MARCA reconocida por el diccionario (None si no es una marca
    conocida). Segunda clave de las reglas aprendidas: lo que el usuario enseña con
    «ZARA MADRID» vale también para «ZARA 0123 SEVILLA». Va después de la clave
    exacta del comercio, que siempre tiene prioridad."""
    marca = clave_marca(comercio) if comercio else None
    return hmac_tag("marca:" + marca) if marca else None


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


def _fetch_user_categories(cur, email: str) -> tuple[list[dict], list[dict]]:
    """(categorías propias, categorías por defecto ocultas) del usuario, descifradas.
    Lo que no se pueda descifrar se ignora: la sugerencia solo se vuelve menos precisa."""
    cur.execute("SELECT tipo, concepto_enc FROM user_categories WHERE user_email = %s", (email,))
    propias = []
    for r in cur.fetchall():
        nombre = _decrypt_or_none(r["concepto_enc"])
        if nombre:
            propias.append({"tipo": r["tipo"], "concepto": nombre})
    cur.execute("SELECT data_enc FROM user_prefs WHERE user_email = %s AND kind = 'hidden_categories'", (email,))
    row = cur.fetchone()
    ocultas = []
    if row:
        try:
            data = json.loads(decrypt_str(bytes(row["data_enc"])))
            ocultas = [o for o in data if isinstance(o, dict)] if isinstance(data, list) else []
        except Exception:
            ocultas = []
    return propias, ocultas


def _regla_de(pend: dict, comercio: str | None, reglas) -> bytes | None:
    """Clave de la regla aprendida que aplica a este pendiente (la del comercio exacto
    primero, luego la de su marca), o None. `reglas`: conjunto/dict de claves existentes."""
    exacta = pend.get("comercio_hmac")
    if exacta and bytes(exacta) in reglas:
        return bytes(exacta)
    marca = brand_tag(comercio)
    return marca if marca and marca in reglas else None


# ── Crear ─────────────────────────────────────────────────────────────────────

async def create_pending(email: str, importe: float, fecha: str | None = None,
                         fuente: str | None = None) -> dict:
    def _q():
        with db_cursor() as cur:
            if fecha:
                cur.execute(
                    "INSERT INTO pending_transactions (user_email, importe, fecha, fuente) "
                    "VALUES (%s, %s, %s::date, %s) RETURNING id, fecha::text, importe",
                    (email, importe, fecha, fuente),
                )
            else:
                cur.execute(
                    "INSERT INTO pending_transactions (user_email, importe, fuente) "
                    "VALUES (%s, %s, %s) RETURNING id, fecha::text, importe",
                    (email, importe, fuente),
                )
            return cur.fetchone()
    return dict(await run_in_thread(_q))


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
    b_hmac = brand_tag(comercio)
    ide_hmac = id_externo_tag(id_externo)
    comercio_enc = encrypt_str(comercio) if comercio else None
    dedup_reciente = c_hmac is not None or fuente == "wallet"

    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 42))", (email,))
            cur.execute(
                """SELECT id, importe, fecha::text, comercio_enc FROM pending_transactions
                   WHERE user_email = %s AND (
                         (%s::bytea IS NOT NULL AND id_externo_hmac = %s::bytea
                          AND created_at > now() - interval '24 hours')
                      OR (%s AND importe = %s::numeric(12,2)
                          AND comercio_hmac IS NOT DISTINCT FROM %s::bytea
                          AND created_at > now() - interval '2 minutes'))
                   ORDER BY id DESC LIMIT 1""",
                (email, ide_hmac, ide_hmac, dedup_reciente, importe, c_hmac),
            )
            dup = cur.fetchone()
            if dup:
                row, duplicada = dict(dup), True
                row["comercio"] = _decrypt_or_none(row.pop("comercio_enc", None))
            else:
                cur.execute(
                    """INSERT INTO pending_transactions
                         (user_email, importe, fecha, comercio_enc, comercio_hmac, fuente, id_externo_hmac)
                       VALUES (%s, %s, %s::date, %s, %s, %s, %s)
                       RETURNING id, importe, fecha::text""",
                    (email, importe, fecha, comercio_enc, c_hmac, fuente, ide_hmac),
                )
                row, duplicada = dict(cur.fetchone()), False
                row["comercio"] = comercio

            # Sugerencia, por orden: a) regla aprendida del usuario (siempre manda);
            # b) diccionario de comercios conocidos; c) historial por importe.
            sugerencia = None
            for tag in (c_hmac, b_hmac):
                if tag is None or sugerencia is not None:
                    continue
                cur.execute(
                    "SELECT tipo, concepto_enc FROM merchant_rules WHERE user_email = %s AND comercio_hmac = %s",
                    (email, tag),
                )
                rule = cur.fetchone()
                if rule:
                    sugerencia = _rule_to_suggestion(rule)
            if sugerencia is None and match_comercio(comercio):
                propias, ocultas = _fetch_user_categories(cur, email)
                sugerencia = suggest_from_dictionary(comercio, propias, ocultas)
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
                "SELECT id, importe, fecha::text, comercio_enc, comercio_hmac, fuente "
                "FROM pending_transactions WHERE user_email = %s ORDER BY created_at ASC",
                (email,),
            )
            pending = cur.fetchall()
            comercios = [_decrypt_or_none(p.get("comercio_enc")) for p in pending]
            # Historial del usuario para sugerir categoría (una sola query)
            cur.execute(
                "SELECT id, tipo, concepto_enc, importe_enc FROM transactions WHERE user_email = %s",
                (email,),
            )
            history = cur.fetchall()
            tags = {bytes(p["comercio_hmac"]) for p in pending if p.get("comercio_hmac")}
            tags |= {t for t in (brand_tag(c) for c in comercios) if t}
            tags = list(tags)
            rules = []
            if tags:
                cur.execute(
                    "SELECT comercio_hmac, tipo, concepto_enc FROM merchant_rules "
                    "WHERE user_email = %s AND comercio_hmac = ANY(%s)",
                    (email, tags),
                )
                rules = cur.fetchall()
            # Categorías del usuario solo si algún pendiente sin regla puede casar con el diccionario
            ruled = {bytes(r["comercio_hmac"]) for r in rules}
            cats = None
            if any(match_comercio(c) and not _regla_de(p, c, ruled) for p, c in zip(pending, comercios)):
                cats = _fetch_user_categories(cur, email)
            return pending, comercios, history, rules, cats

    pending, comercios, history, rules, cats = await run_in_thread(_q)
    history = _decrypt_history(history)
    rules_by_tag = {bytes(r["comercio_hmac"]): r for r in rules}

    result = []
    for r, comercio in zip(pending, comercios):
        item = {
            "id": r["id"],
            "importe": r["importe"],
            "fecha": r["fecha"],
            "comercio": comercio,
            "fuente": r.get("fuente"),
        }
        suggested = None
        tag = _regla_de(r, comercio, rules_by_tag)
        if tag:
            suggested = _rule_to_suggestion(rules_by_tag[tag])
        if suggested is None and cats is not None:
            suggested = suggest_from_dictionary(item["comercio"], *cats)
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
                "SELECT importe, fecha, comercio_hmac, comercio_enc FROM pending_transactions "
                "WHERE id = %s AND user_email = %s",
                (pending_id, email),
            )
            row = cur.fetchone()
            if not row:
                return None
            # Mismo tope y redondeo que el alta directa: un pendiente antiguo
            # (anterior al tope) podría desbordar `importe NUMERIC(10,2)` de PROD.
            try:
                importe = validar_importe(row["importe"])
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
                # Regla del comercio exacto y, si es una marca conocida, también la de la marca
                # (así corregir «Zara Madrid» sirve para «Zara Sevilla»).
                tags = [bytes(c_hmac)]
                marca = brand_tag(_decrypt_or_none(row.get("comercio_enc")))
                if marca and marca not in tags:
                    tags.append(marca)
                for tag in tags:
                    cur.execute(
                        """INSERT INTO merchant_rules (user_email, comercio_hmac, tipo, concepto_enc, hits, updated_at)
                           VALUES (%s, %s, %s, %s, 1, now())
                           ON CONFLICT (user_email, comercio_hmac) DO UPDATE SET
                               tipo = EXCLUDED.tipo, concepto_enc = EXCLUDED.concepto_enc,
                               hits = merchant_rules.hits + 1, updated_at = now()""",
                        (email, tag, tipo, concepto_enc),
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
