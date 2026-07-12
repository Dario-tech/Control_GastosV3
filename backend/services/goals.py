"""Metas de ahorro, con soporte de compartir entre usuarios.

Antes vivían en localStorage (igual que el presupuesto), pero compartir una
meta entre dos cuentas exige una fuente de verdad común — de ahí que pasen
a la base de datos. El total ahorrado de una meta es la suma de las
contribuciones de todos sus miembros, no un campo que se sobrescribe.
"""
from fastapi import HTTPException
from .db import db_cursor, run_in_thread
from .users import get_user


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


async def get_goals_for_user(email: str) -> list[dict]:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                """SELECT g.id, g.nombre, g.objetivo, g.emoji, g.imagen_url, g.fecha::text, g.created_by
                   FROM savings_goals g
                   JOIN savings_goal_members m ON m.goal_id = g.id
                   WHERE m.user_email = %s
                   ORDER BY g.created_at DESC""",
                (email,),
            )
            goals = [dict(r) for r in cur.fetchall()]
            for g in goals:
                cur.execute(
                    "SELECT COALESCE(SUM(importe), 0) AS total FROM savings_goal_contributions WHERE goal_id = %s",
                    (g["id"],),
                )
                g["ahorrado"] = float(cur.fetchone()["total"])
                cur.execute(
                    """SELECT m.user_email, COALESCE(u.name, m.user_email) AS name
                       FROM savings_goal_members m
                       JOIN users u ON u.email = m.user_email
                       WHERE m.goal_id = %s ORDER BY m.joined_at""",
                    (g["id"],),
                )
                members = [dict(r) for r in cur.fetchall()]
                g["members"] = [m["user_email"] for m in members]  # compat: lista de emails
                g["memberNames"] = members  # [{user_email, name}]
                cur.execute(
                    """SELECT c.id, c.user_email, COALESCE(u.name, c.user_email) AS name,
                              c.importe, c.created_at::text AS fecha, c.foto
                       FROM savings_goal_contributions c
                       JOIN users u ON u.email = c.user_email
                       WHERE c.goal_id = %s ORDER BY c.created_at DESC""",
                    (g["id"],),
                )
                contributions = [dict(r) for r in cur.fetchall()]
                for c in contributions:
                    c["importe"] = float(c["importe"])
                g["contributions"] = contributions
            return goals
    return await run_in_thread(_q)


async def get_goal(goal_id: int, email: str) -> dict:
    for g in await get_goals_for_user(email):
        if g["id"] == goal_id:
            return g
    raise HTTPException(status_code=404, detail="Meta no encontrada")


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
    if importe <= 0:
        raise HTTPException(status_code=422, detail="El importe debe ser mayor que 0")

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


async def share_goal(goal_id: int, email: str, invite_email: str) -> dict:
    await _require_member(goal_id, email)
    invite_email = invite_email.strip().lower()

    if invite_email == email:
        raise HTTPException(status_code=422, detail="Ya eres miembro de esta meta")
    if not await get_user(invite_email):
        raise HTTPException(status_code=404, detail="No existe ninguna cuenta con ese email")

    def _q():
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO savings_goal_members (goal_id, user_email)
                   VALUES (%s, %s) ON CONFLICT DO NOTHING""",
                (goal_id, invite_email),
            )
    await run_in_thread(_q)
    return await get_goal(goal_id, email)
