"""Metas de ahorro, con soporte de compartir entre usuarios.

Antes vivían en localStorage (igual que el presupuesto), pero compartir una
meta entre dos cuentas exige una fuente de verdad común — de ahí que pasen
a la base de datos. El total ahorrado de una meta es la suma de las
contribuciones de todos sus miembros, no un campo que se sobrescribe.
"""
from fastapi import HTTPException
from .db import db_cursor, run_in_thread
from .users import get_user
from .importes import validar_importe


def ensure_goals_tables():
    """Migración aditiva e idempotente: crea las tablas de metas si no existen."""
    with db_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS savings_goals (
                id         SERIAL PRIMARY KEY,
                nombre     TEXT NOT NULL,
                objetivo   NUMERIC(12,2) NOT NULL,
                emoji      TEXT NOT NULL DEFAULT '🎯',
                fecha      DATE,
                created_by TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        # Migración aditiva: metas ya existentes en QA no tienen esta columna.
        cur.execute("ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS imagen_url TEXT")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS savings_goal_members (
                goal_id    INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
                user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (goal_id, user_email)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS savings_goal_contributions (
                id         SERIAL PRIMARY KEY,
                goal_id    INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
                user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                importe    NUMERIC(12,2) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        # Foto opcional por aportación (data-URL JPEG comprimida en el cliente).
        cur.execute("ALTER TABLE savings_goal_contributions ADD COLUMN IF NOT EXISTS foto TEXT")
        # Índices aditivos: la PK de members es (goal_id, user_email), así que buscar
        # "metas de un usuario" y "aportaciones de una meta" no tenía índice útil.
        cur.execute("CREATE INDEX IF NOT EXISTS idx_goal_contrib_goal ON savings_goal_contributions(goal_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_goal_members_user ON savings_goal_members(user_email)")


def _fetch_goals(cur, email: str, goal_id: int | None = None) -> list[dict]:
    """Metas del usuario (o solo `goal_id`) con miembros y aportaciones.

    Siempre 3 consultas como máximo, sin importar cuántas metas haya (antes eran
    3 por meta): metas, miembros (ANY) y aportaciones (ANY), agrupadas en Python.
    Las aportaciones NO llevan la foto (hasta ~800 KB cada una): solo `tiene_foto`;
    la imagen se pide aparte con GET /api/goals/{id}/contributions/{cid}/foto."""
    sql = """SELECT g.id, g.nombre, g.objetivo, g.emoji, g.imagen_url, g.fecha::text, g.created_by
             FROM savings_goals g
             JOIN savings_goal_members m ON m.goal_id = g.id
             WHERE m.user_email = %s"""
    params: list = [email]
    if goal_id is not None:
        sql += " AND g.id = %s"
        params.append(goal_id)
    cur.execute(sql + " ORDER BY g.created_at DESC", params)
    goals = [dict(r) for r in cur.fetchall()]
    if not goals:
        return goals
    ids = [g["id"] for g in goals]

    cur.execute(
        """SELECT m.goal_id, m.user_email, COALESCE(u.name, m.user_email) AS name
           FROM savings_goal_members m
           JOIN users u ON u.email = m.user_email
           WHERE m.goal_id = ANY(%s) ORDER BY m.joined_at""",
        (ids,),
    )
    members_by_goal: dict[int, list[dict]] = {i: [] for i in ids}
    for r in cur.fetchall():
        members_by_goal[r["goal_id"]].append({"user_email": r["user_email"], "name": r["name"]})

    # `tiene_foto` se calcula en SQL: la columna foto no viaja a Python.
    cur.execute(
        """SELECT c.goal_id, c.id, c.user_email, COALESCE(u.name, c.user_email) AS name,
                  c.importe, c.created_at::text AS fecha,
                  (c.foto IS NOT NULL AND c.foto <> '') AS tiene_foto
           FROM savings_goal_contributions c
           JOIN users u ON u.email = c.user_email
           WHERE c.goal_id = ANY(%s) ORDER BY c.created_at DESC""",
        (ids,),
    )
    contribs_by_goal: dict[int, list[dict]] = {i: [] for i in ids}
    totals: dict[int, object] = {i: 0 for i in ids}
    for r in cur.fetchall():
        totals[r["goal_id"]] = totals[r["goal_id"]] + r["importe"]  # Decimal exacto, como SUM() en SQL
        contribs_by_goal[r["goal_id"]].append({
            "id": r["id"], "user_email": r["user_email"], "name": r["name"],
            "importe": float(r["importe"]), "fecha": r["fecha"], "tiene_foto": bool(r["tiene_foto"]),
        })

    for g in goals:
        gid = g["id"]
        g["ahorrado"] = float(totals[gid])
        members = members_by_goal[gid]
        g["members"] = [m["user_email"] for m in members]  # compat: lista de emails
        g["memberNames"] = members  # [{user_email, name}]
        g["contributions"] = contribs_by_goal[gid]
    return goals


async def get_goals_for_user(email: str) -> list[dict]:
    def _q():
        with db_cursor() as cur:
            return _fetch_goals(cur, email)
    return await run_in_thread(_q)


async def get_goal(goal_id: int, email: str) -> dict:
    """Una sola meta (3 consultas), sin recargar todas las del usuario."""
    def _q():
        with db_cursor() as cur:
            return _fetch_goals(cur, email, goal_id)
    goals = await run_in_thread(_q)
    if not goals:
        raise HTTPException(status_code=404, detail="Meta no encontrada")
    return goals[0]


async def get_contribution_foto(goal_id: int, contribution_id: int, email: str) -> str:
    """Foto (data URL) de una aportación. Solo para miembros de la meta; 404
    uniforme si la meta/aportación no existe, no se es miembro o no hay foto."""
    def _q():
        with db_cursor() as cur:
            cur.execute(
                """SELECT c.foto FROM savings_goal_contributions c
                   JOIN savings_goal_members m ON m.goal_id = c.goal_id AND m.user_email = %s
                   WHERE c.id = %s AND c.goal_id = %s""",
                (email, contribution_id, goal_id),
            )
            return cur.fetchone()
    row = await run_in_thread(_q)
    if not row or not row["foto"]:
        raise HTTPException(status_code=404, detail="Foto no encontrada")
    return row["foto"]


async def _require_member(goal_id: int, email: str):
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT 1 FROM savings_goal_members WHERE goal_id = %s AND user_email = %s",
                (goal_id, email),
            )
            return cur.fetchone()
    if not await run_in_thread(_q):
        raise HTTPException(status_code=404, detail="Meta no encontrada")


async def _require_creator(goal_id: int, email: str):
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT created_by FROM savings_goals WHERE id = %s", (goal_id,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    if not row:
        raise HTTPException(status_code=404, detail="Meta no encontrada")
    if row["created_by"] != email:
        raise HTTPException(status_code=403, detail="Solo quien creó la meta puede hacer esto")


async def create_goal(
    email: str, nombre: str, objetivo: float, emoji: str, fecha: str | None, imagen_url: str | None = None
) -> dict:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO savings_goals (nombre, objetivo, emoji, fecha, created_by, imagen_url)
                   VALUES (%s, %s, %s, %s::date, %s, %s) RETURNING id""" if fecha else
                """INSERT INTO savings_goals (nombre, objetivo, emoji, created_by, imagen_url)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (nombre, objetivo, emoji, fecha, email, imagen_url) if fecha
                else (nombre, objetivo, emoji, email, imagen_url),
            )
            goal_id = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO savings_goal_members (goal_id, user_email) VALUES (%s, %s)",
                (goal_id, email),
            )
            return goal_id
    goal_id = await run_in_thread(_q)
    return await get_goal(goal_id, email)


async def update_goal(
    goal_id: int, email: str, nombre: str, objetivo: float, emoji: str, fecha: str | None,
    imagen_url: str | None = None,
) -> dict:
    await _require_creator(goal_id, email)

    def _q():
        with db_cursor() as cur:
            cur.execute(
                "UPDATE savings_goals SET nombre=%s, objetivo=%s, emoji=%s, fecha=%s::date, imagen_url=%s WHERE id=%s",
                (nombre, objetivo, emoji, fecha, imagen_url, goal_id),
            )
    await run_in_thread(_q)
    return await get_goal(goal_id, email)


async def delete_goal(goal_id: int, email: str) -> None:
    await _require_creator(goal_id, email)

    def _q():
        with db_cursor() as cur:
            cur.execute("DELETE FROM savings_goals WHERE id = %s", (goal_id,))
    await run_in_thread(_q)


async def contribute(goal_id: int, email: str, importe: float, foto: str | None = None) -> dict:
    await _require_member(goal_id, email)
    try:
        importe = validar_importe(importe)  # > 0, ≤ 1.000.000, céntimos
    except ValueError:
        raise HTTPException(status_code=422, detail="El importe debe ser mayor que 0 y no superar 1.000.000")

    def _q():
        with db_cursor() as cur:
            cur.execute(
                "INSERT INTO savings_goal_contributions (goal_id, user_email, importe, foto) VALUES (%s, %s, %s, %s)",
                (goal_id, email, importe, foto),
            )
    await run_in_thread(_q)
    return await get_goal(goal_id, email)


async def delete_contribution(goal_id: int, contribution_id: int, email: str) -> dict:
    """Corregir una aportación equivocada. Solo puede borrarla quien la hizo,
    o quien creó la meta (por si el error lo cometió la otra persona)."""
    await _require_member(goal_id, email)

    def _get_creator():
        with db_cursor() as cur:
            cur.execute("SELECT created_by FROM savings_goals WHERE id = %s", (goal_id,))
            return cur.fetchone()
    goal_row = await run_in_thread(_get_creator)
    if not goal_row:
        raise HTTPException(status_code=404, detail="Meta no encontrada")
    is_creator = goal_row["created_by"] == email

    def _q():
        with db_cursor() as cur:
            if is_creator:
                cur.execute(
                    "DELETE FROM savings_goal_contributions WHERE id = %s AND goal_id = %s",
                    (contribution_id, goal_id),
                )
            else:
                cur.execute(
                    "DELETE FROM savings_goal_contributions WHERE id = %s AND goal_id = %s AND user_email = %s",
                    (contribution_id, goal_id, email),
                )
            return cur.rowcount
    deleted = await run_in_thread(_q)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Aportación no encontrada")
    return await get_goal(goal_id, email)


SHARE_MSG = "Si la cuenta existe, se ha compartido la meta"


async def share_goal(goal_id: int, email: str, invite_email: str) -> dict:
    """Comparte la meta. Respuesta NEUTRA: es idéntica exista o no la cuenta invitada
    (sin 404 que permita enumerar emails); devuelve la meta + "mensaje"."""
    await _require_member(goal_id, email)
    invite_email = invite_email.strip().lower()

    if invite_email == email:
        raise HTTPException(status_code=422, detail="Ya eres miembro de esta meta")

    if await get_user(invite_email):
        def _q():
            with db_cursor() as cur:
                cur.execute(
                    """INSERT INTO savings_goal_members (goal_id, user_email)
                       VALUES (%s, %s) ON CONFLICT DO NOTHING""",
                    (goal_id, invite_email),
                )
        await run_in_thread(_q)
    goal = await get_goal(goal_id, email)
    return {**goal, "mensaje": SHARE_MSG}
