"""Gastos compartidos (grupos pequeños). Diseño: docs-diseno-gastos-compartidos.md.

Reglas de oro (igual que las metas compartidas):
- TODA consulta filtra por pertenencia al grupo; un no miembro recibe el mismo 404
  que un grupo inexistente.
- Nombre del grupo, concepto, importes y partes van cifrados (AES-GCM, crypto.py).
- El saldo se calcula en Python, en céntimos enteros, tras descifrar.
- Nada de esto registra en logs conceptos, nombres ni importes.
"""
import logging
from fastapi import HTTPException

from .db import db_cursor, run_in_thread
from .crypto import encrypt_str, decrypt_str, encrypt_float, decrypt_float
from .importes import validar_importe
from .users import get_user
from .wallet import parse_fecha

_log = logging.getLogger("uvicorn.error")

NOMBRE_MAX = 60
CONCEPTO_MAX = 60
MAX_MIEMBROS = 20
MAX_GRUPOS_CREADOS = 20
MAX_GASTOS = 2000
MAX_PAGOS = 2000
INVITE_MSG = "Si la cuenta existe, se ha añadido al grupo"
NOT_FOUND = "Grupo no encontrado"


def ensure_groups_tables():
    """Migración aditiva e idempotente: crea las tablas de gastos compartidos si no existen."""
    with db_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS expense_groups (
                id         SERIAL PRIMARY KEY,
                nombre_enc BYTEA NOT NULL,
                created_by TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS expense_group_members (
                group_id   INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
                user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (group_id, user_email)
            )""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS group_expenses (
                id           SERIAL PRIMARY KEY,
                group_id     INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
                paid_by      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                concepto_enc BYTEA NOT NULL,
                importe_enc  BYTEA NOT NULL,
                fecha        DATE NOT NULL,
                modo         TEXT NOT NULL CHECK (modo IN ('igual', 'importes')),
                created_by   TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS group_expense_shares (
                expense_id INTEGER NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
                user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                share_enc  BYTEA NOT NULL,
                PRIMARY KEY (expense_id, user_email)
            )""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS group_settlements (
                id          SERIAL PRIMARY KEY,
                group_id    INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
                from_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                to_email    TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                importe_enc BYTEA NOT NULL,
                fecha       DATE NOT NULL,
                created_by  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_group_expenses_group ON group_expenses(group_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_group_settlements_group ON group_settlements(group_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_group_members_user ON expense_group_members(user_email)")
        for t in ("expense_groups", "expense_group_members", "group_expenses", "group_expense_shares", "group_settlements"):
            cur.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")


# ── Lógica pura (céntimos enteros) ───────────────────────────────────────────

def a_centimos(importe: float) -> int:
    return int(round(float(importe) * 100))


def de_centimos(c: int) -> float:
    return round(c / 100, 2)


def reparto_igual(total: int, participantes: list[str]) -> dict[str, int]:
    """Divide `total` céntimos entre los participantes; el resto va de uno en uno a los
    primeros por orden alfabético de email (determinista; la suma siempre cuadra)."""
    orden = sorted(set(participantes))
    if not orden:
        raise ValueError("Elige al menos un participante")
    base, resto = divmod(total, len(orden))
    return {e: base + (1 if i < resto else 0) for i, e in enumerate(orden)}


def calcular_partes(total: int, reparto, miembros: list[str]) -> tuple[str, dict[str, int]]:
    """Valida el reparto pedido y devuelve (modo, {email: céntimos}). ValueError con
    mensaje genérico (sin importes ni textos recibidos)."""
    if not isinstance(reparto, dict):
        raise ValueError("Reparto inválido")
    modo = reparto.get("modo")
    if modo == "igual":
        part = reparto.get("participantes")
        if part is None:
            part = list(miembros)
        if not isinstance(part, list) or not all(isinstance(p, str) for p in part):
            raise ValueError("Reparto inválido")
        part = [p.strip().lower() for p in part]
        if not part or any(p not in miembros for p in part):
            raise ValueError("Los participantes deben ser miembros del grupo")
        return "igual", reparto_igual(total, part)
    if modo == "importes":
        partes = reparto.get("partes")
        if not isinstance(partes, dict) or not partes:
            raise ValueError("Reparto inválido")
        out: dict[str, int] = {}
        for e, v in partes.items():
            e = str(e).strip().lower()
            if e not in miembros or e in out:
                raise ValueError("Los participantes deben ser miembros del grupo")
            try:
                out[e] = a_centimos(validar_importe(v))
            except ValueError:
                raise ValueError("Cada parte debe ser mayor que 0")
        if sum(out.values()) != total:
            raise ValueError("Las partes deben sumar exactamente el importe del gasto")
        return "importes", out
    raise ValueError("Reparto inválido")


def calcular_saldos(miembros: list[str], gastos: list[dict], pagos: list[dict]) -> dict[str, int]:
    """Saldo en céntimos por miembro: + le deben, − debe."""
    net = {m: 0 for m in miembros}
    for g in gastos:
        net[g["pagado_por"]] = net.get(g["pagado_por"], 0) + g["_total"]
        for e, c in g["_partes"].items():
            net[e] = net.get(e, 0) - c
    for p in pagos:
        net[p["de"]] = net.get(p["de"], 0) + p["_total"]
        net[p["a"]] = net.get(p["a"], 0) - p["_total"]
    return net


def simplificar_deudas(net: dict[str, int]) -> list[dict]:
    """Voraz: el mayor deudor paga al mayor acreedor hasta saldar todo."""
    deben = sorted(([-v, e] for e, v in net.items() if v < 0), key=lambda x: (-x[0], x[1]))
    cobran = sorted(([v, e] for e, v in net.items() if v > 0), key=lambda x: (-x[0], x[1]))
    out = []
    i = j = 0
    while i < len(deben) and j < len(cobran):
        pago = min(deben[i][0], cobran[j][0])
        out.append({"de": deben[i][1], "a": cobran[j][1], "importe": de_centimos(pago)})
        deben[i][0] -= pago
        cobran[j][0] -= pago
        if deben[i][0] == 0:
            i += 1
        if cobran[j][0] == 0:
            j += 1
    return out


def _texto(raw, maximo: int, vacio_msg: str) -> str:
    if not isinstance(raw, str):
        raise HTTPException(status_code=422, detail=vacio_msg)
    s = " ".join(raw.split())
    if not s:
        raise HTTPException(status_code=422, detail=vacio_msg)
    if len(s) > maximo:
        raise HTTPException(status_code=422, detail=f"No puede superar {maximo} caracteres")
    if any(0xD800 <= ord(c) <= 0xDFFF for c in s):
        raise HTTPException(status_code=422, detail="Texto inválido")
    return s


def _importe(v) -> float:
    try:
        return validar_importe(v)
    except ValueError:
        raise HTTPException(status_code=422, detail="El importe debe ser mayor que 0 y no superar 1.000.000")


def _fecha(raw) -> str:
    try:
        return parse_fecha(raw).isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail="Fecha inválida")


def _dec_str(blob, what: str, row_id) -> str | None:
    try:
        return decrypt_str(bytes(blob))
    except Exception as e:
        _log.warning("No se pudo descifrar %s id=%s (%s)", what, row_id, type(e).__name__)
        return None


def _dec_num(blob, what: str, row_id) -> float | None:
    try:
        return decrypt_float(bytes(blob))
    except Exception as e:
        _log.warning("No se pudo descifrar %s id=%s (%s)", what, row_id, type(e).__name__)
        return None


# ── Acceso a datos (siempre filtrado por pertenencia) ────────────────────────

def _miembros(cur, gid: int, email: str) -> list[str]:
    """Emails de los miembros del grupo; 404 si `email` NO es miembro (o no existe el grupo)."""
    cur.execute(
        "SELECT user_email FROM expense_group_members WHERE group_id = %s ORDER BY joined_at, user_email",
        (gid,),
    )
    emails = [r["user_email"] for r in cur.fetchall()]
    if email not in emails:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return emails


def _nombres(cur, emails: list[str]) -> dict[str, str]:
    cur.execute("SELECT email, COALESCE(NULLIF(name, ''), email) AS name FROM users WHERE email = ANY(%s)", (emails,))
    return {r["email"]: r["name"] for r in cur.fetchall()}


def _detalle(cur, gid: int, email: str) -> dict:
    miembros = _miembros(cur, gid, email)
    cur.execute("SELECT id, nombre_enc, created_by FROM expense_groups WHERE id = %s", (gid,))
    g = cur.fetchone()
    if not g:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    nombres = _nombres(cur, miembros)

    cur.execute(
        """SELECT id, paid_by, concepto_enc, importe_enc, fecha::text AS fecha, modo, created_by
           FROM group_expenses WHERE group_id = %s ORDER BY fecha DESC, id DESC""",
        (gid,),
    )
    filas = cur.fetchall()
    ids = [r["id"] for r in filas]
    partes_por_gasto: dict[int, dict[str, int]] = {i: {} for i in ids}
    if ids:
        cur.execute("SELECT expense_id, user_email, share_enc FROM group_expense_shares WHERE expense_id = ANY(%s)", (ids,))
        for s in cur.fetchall():
            v = _dec_num(s["share_enc"], "parte", s["expense_id"])
            if v is not None:
                partes_por_gasto[s["expense_id"]][s["user_email"]] = a_centimos(v)

    sin_leer = 0
    gastos = []
    for r in filas:
        concepto = _dec_str(r["concepto_enc"], "gasto", r["id"])
        total = _dec_num(r["importe_enc"], "gasto", r["id"])
        if concepto is None or total is None:
            sin_leer += 1
            continue
        partes = partes_por_gasto[r["id"]]
        gastos.append({
            "id": r["id"], "concepto": concepto, "importe": total, "fecha": r["fecha"],
            "pagado_por": r["paid_by"], "modo": r["modo"], "creado_por": r["created_by"],
            "partes": {e: de_centimos(c) for e, c in partes.items()},
            "_total": a_centimos(total), "_partes": partes,
        })

    cur.execute(
        """SELECT id, from_email, to_email, importe_enc, fecha::text AS fecha, created_by
           FROM group_settlements WHERE group_id = %s ORDER BY fecha DESC, id DESC""",
        (gid,),
    )
    pagos = []
    for r in cur.fetchall():
        v = _dec_num(r["importe_enc"], "pago", r["id"])
        if v is None:
            sin_leer += 1
            continue
        pagos.append({"id": r["id"], "de": r["from_email"], "a": r["to_email"], "importe": v,
                      "fecha": r["fecha"], "creado_por": r["created_by"], "_total": a_centimos(v)})

    net = calcular_saldos(miembros, gastos, pagos)
    nombre = _dec_str(g["nombre_enc"], "grupo", gid) or "Grupo"
    for x in gastos:
        x.pop("_total"); x.pop("_partes")
    for x in pagos:
        x.pop("_total")
    return {
        "id": gid, "nombre": nombre, "creado_por": g["created_by"],
        "miembros": [{"email": m, "nombre": nombres.get(m, m)} for m in miembros],
        "gastos": gastos, "pagos": pagos,
        "saldos": {m: de_centimos(c) for m, c in net.items()},
        "deudas": simplificar_deudas(net),
        "sin_leer": sin_leer,
    }


async def list_groups(email: str) -> list[dict]:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                """SELECT g.id, g.nombre_enc, g.created_by
                   FROM expense_groups g JOIN expense_group_members m ON m.group_id = g.id
                   WHERE m.user_email = %s ORDER BY g.created_at DESC""",
                (email,),
            )
            groups = cur.fetchall()
            if not groups:
                return []
            ids = [g["id"] for g in groups]
            cur.execute(
                """SELECT m.group_id, m.user_email, COALESCE(NULLIF(u.name, ''), m.user_email) AS name
                   FROM expense_group_members m JOIN users u ON u.email = m.user_email
                   WHERE m.group_id = ANY(%s) ORDER BY m.joined_at""",
                (ids,),
            )
            by_group: dict[int, list[dict]] = {i: [] for i in ids}
            for r in cur.fetchall():
                by_group[r["group_id"]].append({"email": r["user_email"], "nombre": r["name"]})
            return [{
                "id": g["id"], "nombre": _dec_str(g["nombre_enc"], "grupo", g["id"]) or "Grupo",
                "creado_por": g["created_by"], "miembros": by_group[g["id"]],
            } for g in groups]
    return await run_in_thread(_q)


async def get_group(gid: int, email: str) -> dict:
    def _q():
        with db_cursor() as cur:
            return _detalle(cur, gid, email)
    return await run_in_thread(_q)


async def create_group(email: str, nombre) -> dict:
    nombre = _texto(nombre, NOMBRE_MAX, "El nombre no puede estar vacío")

    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM expense_groups WHERE created_by = %s", (email,))
            if cur.fetchone()["n"] >= MAX_GRUPOS_CREADOS:
                raise HTTPException(status_code=422, detail=f"Máximo {MAX_GRUPOS_CREADOS} grupos creados")
            cur.execute("INSERT INTO expense_groups (nombre_enc, created_by) VALUES (%s, %s) RETURNING id",
                        (encrypt_str(nombre), email))
            gid = cur.fetchone()["id"]
            cur.execute("INSERT INTO expense_group_members (group_id, user_email) VALUES (%s, %s)", (gid, email))
            return _detalle(cur, gid, email)
    return await run_in_thread(_q)


async def delete_group(gid: int, email: str) -> None:
    def _q():
        with db_cursor() as cur:
            _miembros(cur, gid, email)
            cur.execute("SELECT created_by FROM expense_groups WHERE id = %s", (gid,))
            g = cur.fetchone()
            if not g:
                raise HTTPException(status_code=404, detail=NOT_FOUND)
            if g["created_by"] != email:
                raise HTTPException(status_code=403, detail="Solo quien creó el grupo puede borrarlo")
            cur.execute("DELETE FROM expense_groups WHERE id = %s", (gid,))
    await run_in_thread(_q)


async def invite(gid: int, email: str, invite_email) -> dict:
    """Añade a un usuario YA registrado. Respuesta neutra exista o no la cuenta."""
    if not isinstance(invite_email, str) or not invite_email.strip() or len(invite_email) > 254:
        raise HTTPException(status_code=422, detail="Email inválido")
    invite_email = invite_email.strip().lower()
    exists = await get_user(invite_email) if invite_email != email else None

    def _q():
        with db_cursor() as cur:
            miembros = _miembros(cur, gid, email)
            if invite_email == email:
                raise HTTPException(status_code=422, detail="Ya eres miembro de este grupo")
            if exists and invite_email not in miembros:
                if len(miembros) >= MAX_MIEMBROS:
                    raise HTTPException(status_code=422, detail=f"Máximo {MAX_MIEMBROS} miembros por grupo")
                cur.execute(
                    "INSERT INTO expense_group_members (group_id, user_email) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (gid, invite_email),
                )
            return _detalle(cur, gid, email)
    return {**(await run_in_thread(_q)), "mensaje": INVITE_MSG}


async def add_expense(gid: int, email: str, concepto, importe, fecha, pagado_por, reparto) -> dict:
    concepto = _texto(concepto, CONCEPTO_MAX, "El concepto no puede estar vacío")
    total = a_centimos(_importe(importe))
    fecha_iso = _fecha(fecha)
    if pagado_por is not None and not isinstance(pagado_por, str):
        raise HTTPException(status_code=422, detail="Pagador inválido")

    def _q():
        with db_cursor() as cur:
            miembros = _miembros(cur, gid, email)
            pagador = (pagado_por or email).strip().lower()
            if pagador not in miembros:
                raise HTTPException(status_code=422, detail="El pagador debe ser miembro del grupo")
            try:
                modo, partes = calcular_partes(total, reparto, miembros)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
            cur.execute("SELECT count(*) AS n FROM group_expenses WHERE group_id = %s", (gid,))
            if cur.fetchone()["n"] >= MAX_GASTOS:
                raise HTTPException(status_code=422, detail="Este grupo ha alcanzado el máximo de gastos")
            cur.execute(
                """INSERT INTO group_expenses (group_id, paid_by, concepto_enc, importe_enc, fecha, modo, created_by)
                   VALUES (%s, %s, %s, %s, %s::date, %s, %s) RETURNING id""",
                (gid, pagador, encrypt_str(concepto), encrypt_float(de_centimos(total)), fecha_iso, modo, email),
            )
            eid = cur.fetchone()["id"]
            for e, c in partes.items():
                cur.execute(
                    "INSERT INTO group_expense_shares (expense_id, user_email, share_enc) VALUES (%s, %s, %s)",
                    (eid, e, encrypt_float(de_centimos(c))),
                )
            return _detalle(cur, gid, email)
    return await run_in_thread(_q)


def _puede_borrar(cur, gid: int, email: str, creado_por: str) -> bool:
    cur.execute("SELECT created_by FROM expense_groups WHERE id = %s", (gid,))
    g = cur.fetchone()
    return email == creado_por or (g is not None and g["created_by"] == email)


async def delete_expense(gid: int, expense_id: int, email: str) -> dict:
    def _q():
        with db_cursor() as cur:
            _miembros(cur, gid, email)
            cur.execute("SELECT created_by FROM group_expenses WHERE id = %s AND group_id = %s", (expense_id, gid))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Gasto no encontrado")
            if not _puede_borrar(cur, gid, email, row["created_by"]):
                raise HTTPException(status_code=403, detail="Solo quien lo creó o el creador del grupo puede borrarlo")
            cur.execute("DELETE FROM group_expenses WHERE id = %s AND group_id = %s", (expense_id, gid))
            return _detalle(cur, gid, email)
    return await run_in_thread(_q)


async def add_settlement(gid: int, email: str, de, a, importe, fecha) -> dict:
    total = a_centimos(_importe(importe))
    fecha_iso = _fecha(fecha)
    if not isinstance(de, str) or not isinstance(a, str):
        raise HTTPException(status_code=422, detail="Pago inválido")
    de, a = de.strip().lower(), a.strip().lower()

    def _q():
        with db_cursor() as cur:
            miembros = _miembros(cur, gid, email)
            if de == a or de not in miembros or a not in miembros:
                raise HTTPException(status_code=422, detail="El pago debe ser entre dos miembros distintos")
            if email not in (de, a):
                raise HTTPException(status_code=403, detail="Solo quien paga o quien cobra puede registrar el pago")
            cur.execute("SELECT count(*) AS n FROM group_settlements WHERE group_id = %s", (gid,))
            if cur.fetchone()["n"] >= MAX_PAGOS:
                raise HTTPException(status_code=422, detail="Este grupo ha alcanzado el máximo de pagos")
            cur.execute(
                """INSERT INTO group_settlements (group_id, from_email, to_email, importe_enc, fecha, created_by)
                   VALUES (%s, %s, %s, %s, %s::date, %s)""",
                (gid, de, a, encrypt_float(de_centimos(total)), fecha_iso, email),
            )
            return _detalle(cur, gid, email)
    return await run_in_thread(_q)


async def delete_settlement(gid: int, settlement_id: int, email: str) -> dict:
    def _q():
        with db_cursor() as cur:
            _miembros(cur, gid, email)
            cur.execute("SELECT created_by FROM group_settlements WHERE id = %s AND group_id = %s", (settlement_id, gid))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pago no encontrado")
            if not _puede_borrar(cur, gid, email, row["created_by"]):
                raise HTTPException(status_code=403, detail="Solo quien lo registró o el creador del grupo puede borrarlo")
            cur.execute("DELETE FROM group_settlements WHERE id = %s AND group_id = %s", (settlement_id, gid))
            return _detalle(cur, gid, email)
    return await run_in_thread(_q)
