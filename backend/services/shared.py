"""Gastos compartidos integrados en los movimientos. Diseño: docs-diseno-gastos-compartidos-v2.md (enfoque A).

Modelo: un gasto compartido ES un movimiento normal (`transactions`) con un reparto asociado.
- Las personas (`shared_people`) son contactos del propio usuario, SIN cuenta: todo se apunta
  desde su móvil. No hay nada compartido entre cuentas, así que no hay fugas posibles entre usuarios
  (toda consulta filtra por `user_email`).
- En tus estadísticas cuenta lo que pagaste (decisión del usuario). Si pagó otra persona, el movimiento
  es tu parte. Cobrar/pagar una deuda (liquidación) NO crea ingreso ni gasto.
- Claves de participante: 'yo' o 'p:<id>'. Importes/partes/nombres cifrados (crypto.py); saldo en
  céntimos enteros tras descifrar. Nada registra en logs nombres ni importes.
"""
import logging
from fastapi import HTTPException

from .db import db_cursor, run_in_thread
from .crypto import encrypt_str, encrypt_float, decrypt_str, decrypt_float
from .groups import (
    a_centimos, de_centimos, calcular_partes, calcular_saldos,
    _texto, _importe, _fecha,
)
from .sheets import insert_transaction_sync

_log = logging.getLogger("uvicorn.error")

YO = "yo"
PREFIX = "p:"
NOMBRE_MAX = 60
ETIQUETA_MAX = 40
MAX_PERSONAS = 50
MAX_GASTOS = 5000
MAX_PAGOS = 5000
NOT_FOUND = "No encontrado"


def ensure_shared_tables():
    """Migración aditiva e idempotente (el SQL equivalente está en schema.sql)."""
    with db_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shared_people (
                id         SERIAL PRIMARY KEY,
                user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                nombre_enc BYTEA NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shared_expenses (
                id             SERIAL PRIMARY KEY,
                user_email     TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                transaction_id INTEGER UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
                paid_by        TEXT NOT NULL,  -- 'yo' o 'p:<id>'
                total_enc      BYTEA NOT NULL,
                fecha          DATE NOT NULL,
                etiqueta_enc   BYTEA,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shared_shares (
                expense_id INTEGER NOT NULL REFERENCES shared_expenses(id) ON DELETE CASCADE,
                party      TEXT NOT NULL,  -- 'yo' o 'p:<id>'
                share_enc  BYTEA NOT NULL,
                PRIMARY KEY (expense_id, party)
            )""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shared_settlements (
                id          SERIAL PRIMARY KEY,
                user_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                from_party  TEXT NOT NULL,
                to_party    TEXT NOT NULL,
                importe_enc BYTEA NOT NULL,
                fecha       DATE NOT NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_shared_people_user ON shared_people(user_email)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_shared_expenses_user ON shared_expenses(user_email)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_shared_settlements_user ON shared_settlements(user_email)")
        for t in ("shared_people", "shared_expenses", "shared_shares", "shared_settlements"):
            cur.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")


def _dec_str(blob, what, row_id):
    try:
        return decrypt_str(bytes(blob))
    except Exception as e:
        _log.warning("No se pudo descifrar %s id=%s (%s)", what, row_id, type(e).__name__)
        return None


def _dec_num(blob, what, row_id):
    try:
        return decrypt_float(bytes(blob))
    except Exception as e:
        _log.warning("No se pudo descifrar %s id=%s (%s)", what, row_id, type(e).__name__)
        return None


def _personas(cur, email: str) -> dict[str, str]:
    """{clave: nombre} de las personas del usuario (solo las suyas)."""
    cur.execute("SELECT id, nombre_enc FROM shared_people WHERE user_email = %s ORDER BY id", (email,))
    return {f"{PREFIX}{r['id']}": _dec_str(r["nombre_enc"], "persona", r["id"]) or "Persona" for r in cur.fetchall()}


def _estado(cur, email: str) -> dict:
    """Saldos y deudas por persona + resumen por movimiento (para el distintivo en Mes)."""
    personas = _personas(cur, email)
    cur.execute(
        """SELECT id, transaction_id, paid_by, total_enc, fecha::text AS fecha, etiqueta_enc
           FROM shared_expenses WHERE user_email = %s ORDER BY fecha DESC, id DESC""", (email,))
    filas = cur.fetchall()
    ids = [r["id"] for r in filas]
    partes_de: dict[int, dict[str, int]] = {i: {} for i in ids}
    if ids:
        # Pertenencia ya verificada: ids salen de gastos del propio usuario.
        cur.execute("SELECT expense_id, party, share_enc FROM shared_shares WHERE expense_id = ANY(%s)", (ids,))
        for s in cur.fetchall():
            v = _dec_num(s["share_enc"], "parte", s["expense_id"])
            if v is not None:
                partes_de[s["expense_id"]][s["party"]] = a_centimos(v)
    gastos, sin_leer = [], 0
    for r in filas:
        total = _dec_num(r["total_enc"], "gasto", r["id"])
        if total is None:
            sin_leer += 1
            continue
        gastos.append({
            "id": r["id"], "transaction_id": r["transaction_id"], "pagado_por": r["paid_by"],
            "fecha": r["fecha"], "etiqueta": _dec_str(r["etiqueta_enc"], "etiqueta", r["id"]) if r["etiqueta_enc"] else None,
            "importe": total, "partes": {k: de_centimos(c) for k, c in partes_de[r["id"]].items()},
            "_total": a_centimos(total), "_partes": partes_de[r["id"]],
        })
    cur.execute(
        """SELECT id, from_party, to_party, importe_enc, fecha::text AS fecha
           FROM shared_settlements WHERE user_email = %s ORDER BY fecha DESC, id DESC""", (email,))
    pagos = []
    for r in cur.fetchall():
        v = _dec_num(r["importe_enc"], "liquidacion", r["id"])
        if v is None:
            sin_leer += 1
            continue
        pagos.append({"id": r["id"], "de": r["from_party"], "a": r["to_party"], "importe": v,
                      "fecha": r["fecha"], "_total": a_centimos(v)})
    claves = [YO] + list(personas)
    net = calcular_saldos(claves, gastos, pagos)  # + le deben, − debe
    por_tx = {}
    for g in gastos:
        if g["transaction_id"] is not None:
            por_tx[str(g["transaction_id"])] = {
                "gasto_id": g["id"], "total": g["importe"], "mi_parte": g["partes"].get(YO, 0.0),
                "pagado_por_mi": g["pagado_por"] == YO, "etiqueta": g["etiqueta"],
                "con": [k for k in g["partes"] if k != YO],
            }
    for x in gastos:
        x.pop("_total"); x.pop("_partes")
    for x in pagos:
        x.pop("_total")
    return {
        # saldo de la persona respecto a MÍ: + me debe, − le debo
        "personas": [{"clave": k, "id": int(k[len(PREFIX):]), "nombre": n,
                      "saldo": de_centimos(-net.get(k, 0))} for k, n in personas.items()],
        "gastos": gastos, "pagos": pagos, "por_transaccion": por_tx, "sin_leer": sin_leer,
        "saldo_total": de_centimos(sum(-net.get(k, 0) for k in personas)),
    }


async def get_state(email: str) -> dict:
    def _q():
        with db_cursor() as cur:
            return _estado(cur, email)
    return await run_in_thread(_q)


async def add_person(email: str, nombre) -> dict:
    nombre = _texto(nombre, NOMBRE_MAX, "El nombre no puede estar vacío")

    def _q():
        with db_cursor() as cur:
            personas = _personas(cur, email)
            if len(personas) >= MAX_PERSONAS:
                raise HTTPException(status_code=422, detail=f"Máximo {MAX_PERSONAS} personas")
            if nombre.casefold() in {n.casefold() for n in personas.values()}:
                raise HTTPException(status_code=422, detail="Ya tienes a alguien con ese nombre")
            cur.execute("INSERT INTO shared_people (user_email, nombre_enc) VALUES (%s, %s)",
                        (email, encrypt_str(nombre)))
            return _estado(cur, email)
    return await run_in_thread(_q)


async def delete_person(email: str, person_id: int) -> dict:
    clave = f"{PREFIX}{person_id}"

    def _q():
        with db_cursor() as cur:
            if clave not in _personas(cur, email):
                raise HTTPException(status_code=404, detail=NOT_FOUND)
            cur.execute(
                """SELECT 1 FROM shared_expenses WHERE user_email = %s AND paid_by = %s
                   UNION ALL SELECT 1 FROM shared_shares s JOIN shared_expenses e ON e.id = s.expense_id
                             WHERE e.user_email = %s AND s.party = %s
                   UNION ALL SELECT 1 FROM shared_settlements WHERE user_email = %s AND (from_party = %s OR to_party = %s)
                   LIMIT 1""",
                (email, clave, email, clave, email, clave, clave))
            if cur.fetchone():
                raise HTTPException(status_code=422, detail="Tiene gastos o pagos asociados: bórralos antes")
            cur.execute("DELETE FROM shared_people WHERE id = %s AND user_email = %s", (person_id, email))
            return _estado(cur, email)
    return await run_in_thread(_q)


async def add_expense(email: str, importe, tipo: str, concepto: str, fecha: str | None,
                      comentario: str | None, id_cliente: str | None,
                      pagado_por, reparto, etiqueta) -> dict:
    """Crea movimiento + reparto en UNA transacción de BD. `tipo`, `concepto`, `fecha` y
    `comentario` llegan ya validados por main (_validate_tx_patch)."""
    total = a_centimos(_importe(importe))
    fecha_iso = _fecha(fecha) if fecha else None
    if pagado_por is not None and not isinstance(pagado_por, str):
        raise HTTPException(status_code=422, detail="Pagador inválido")
    if etiqueta is not None:
        etiqueta = _texto(etiqueta, ETIQUETA_MAX, "Etiqueta inválida") if str(etiqueta).strip() else None

    def _q():
        with db_cursor() as cur:
            personas = _personas(cur, email)
            claves = [YO] + list(personas)
            pagador = (pagado_por or YO).strip().lower()
            if pagador not in claves:
                raise HTTPException(status_code=422, detail="El pagador no es válido")
            try:
                modo, partes = calcular_partes(total, reparto, claves)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
            if not any(k != YO for k in partes):
                raise HTTPException(status_code=422, detail="Elige al menos otra persona con quien dividir")
            cur.execute("SELECT count(*) AS n FROM shared_expenses WHERE user_email = %s", (email,))
            if cur.fetchone()["n"] >= MAX_GASTOS:
                raise HTTPException(status_code=422, detail="Has alcanzado el máximo de gastos compartidos")
            # Tu economía: lo que pagaste (total) o, si pagó otra persona, tu parte.
            mi_importe = total if pagador == YO else partes.get(YO, 0)
            tx_id, fecha_tx, duplicada = None, fecha_iso, False
            if mi_importe > 0:
                row, duplicada = insert_transaction_sync(
                    cur, de_centimos(mi_importe), tipo, concepto, email, fecha_iso, comentario, id_cliente)
                tx_id, fecha_tx = row["id"], row["fecha"]
            if duplicada:  # reintento: ya está todo guardado
                return {"status": "ok", "id": tx_id, "fecha": fecha_tx, "duplicada": True, **_estado(cur, email)}
            cur.execute(
                """INSERT INTO shared_expenses (user_email, transaction_id, paid_by, total_enc, fecha, etiqueta_enc)
                   VALUES (%s, %s, %s, %s, COALESCE(%s::date, CURRENT_DATE), %s) RETURNING id""",
                (email, tx_id, pagador, encrypt_float(de_centimos(total)), fecha_tx,
                 encrypt_str(etiqueta) if etiqueta else None))
            eid = cur.fetchone()["id"]
            for k, c in partes.items():
                cur.execute("INSERT INTO shared_shares (expense_id, party, share_enc) VALUES (%s, %s, %s)",
                            (eid, k, encrypt_float(de_centimos(c))))
            return {"status": "ok", "id": tx_id, "fecha": fecha_tx, "modo": modo, **_estado(cur, email)}
    return await run_in_thread(_q)


async def delete_expense(email: str, expense_id: int) -> dict:
    """Borra el reparto Y el movimiento propio asociado."""
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT transaction_id FROM shared_expenses WHERE id = %s AND user_email = %s",
                        (expense_id, email))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail=NOT_FOUND)
            if r["transaction_id"] is not None:
                cur.execute("DELETE FROM transactions WHERE id = %s AND user_email = %s", (r["transaction_id"], email))
            cur.execute("DELETE FROM shared_expenses WHERE id = %s AND user_email = %s", (expense_id, email))
            return _estado(cur, email)
    return await run_in_thread(_q)


async def add_settlement(email: str, person_id: int, direccion, importe, fecha) -> dict:
    """Liquidación con una persona: 'cobro' (te paga a ti) o 'pago' (le pagas tú). Neutral:
    no crea ingreso ni gasto en tus movimientos."""
    total = a_centimos(_importe(importe))
    fecha_iso = _fecha(fecha)
    if direccion not in ("cobro", "pago"):
        raise HTTPException(status_code=422, detail="Dirección inválida")
    clave = f"{PREFIX}{person_id}"

    def _q():
        with db_cursor() as cur:
            if clave not in _personas(cur, email):
                raise HTTPException(status_code=404, detail=NOT_FOUND)
            cur.execute("SELECT count(*) AS n FROM shared_settlements WHERE user_email = %s", (email,))
            if cur.fetchone()["n"] >= MAX_PAGOS:
                raise HTTPException(status_code=422, detail="Has alcanzado el máximo de liquidaciones")
            de, a = (clave, YO) if direccion == "cobro" else (YO, clave)
            cur.execute(
                """INSERT INTO shared_settlements (user_email, from_party, to_party, importe_enc, fecha)
                   VALUES (%s, %s, %s, %s, %s::date)""",
                (email, de, a, encrypt_float(de_centimos(total)), fecha_iso))
            return _estado(cur, email)
    return await run_in_thread(_q)


async def delete_settlement(email: str, settlement_id: int) -> dict:
    def _q():
        with db_cursor() as cur:
            cur.execute("DELETE FROM shared_settlements WHERE id = %s AND user_email = %s RETURNING id",
                        (settlement_id, email))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail=NOT_FOUND)
            return _estado(cur, email)
    return await run_in_thread(_q)
