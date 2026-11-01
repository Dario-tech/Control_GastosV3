import os
import secrets
from fastapi import HTTPException
from .db import db_cursor, run_in_thread

REGISTRO_CERRADO_MSG = "El registro está cerrado. Pídele acceso al administrador."


def registration_open() -> bool:
    """ALLOW_REGISTER=true|1|yes abre el alta de usuarios nuevos (registro con
    contraseña y primer login con Google). Por defecto, o con cualquier otro valor,
    está CERRADO. Se lee en cada llamada (no al importar)."""
    return os.getenv("ALLOW_REGISTER", "").strip().lower() in ("true", "1", "yes")


def registro_cerrado_error() -> HTTPException:
    return HTTPException(status_code=403, detail=REGISTRO_CERRADO_MSG)


def ensure_password_column():
    """Migración ADITIVA e idempotente: añade la columna password_hash si no existe.
    No borra ni modifica datos existentes. Los usuarios de Google la tendrán a NULL.
    Se ejecuta al arrancar el backend."""
    with db_cursor() as cur:
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT")


async def get_user(email: str) -> dict | None:
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT email, name, shortcut_token FROM users WHERE email = %s", (email,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row) if row else None


async def get_password_hash(email: str) -> str | None:
    """Devuelve el hash de contraseña, o None si el usuario no existe o es solo-Google."""
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT password_hash FROM users WHERE email = %s", (email,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return (row["password_hash"] if row else None)


async def create_user_with_password(email: str, name: str, password_hash: str) -> dict | None:
    """Crea un usuario con contraseña. Devuelve None si el email ya existe."""
    def _q():
        token = secrets.token_urlsafe(32)
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO users (email, name, shortcut_token, password_hash)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (email) DO NOTHING
                   RETURNING email, name, shortcut_token""",
                (email, name, token, password_hash),
            )
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row) if row else None


async def ensure_user(email: str, name: str) -> dict:
    """Alta/entrada por Google. Si el usuario ya existe actualiza el nombre; si es NUEVO
    solo lo crea con el registro abierto (ALLOW_REGISTER), si no lanza 403.

    Un usuario creado aquí NUNCA tiene password_hash (la columna queda a NULL). Si ya
    existía una fila con hash (alta previa con contraseña) y entra por Google, el hash
    no se toca (no es de Google). Riesgo de pre-secuestro: quien registre antes un email
    ajeno con contraseña conservaría acceso a esa cuenta cuando su dueño entre por
    Google; con el registro cerrado (por defecto) no hay forma de crear esa fila."""
    abierto = registration_open()

    def _q():
        token = secrets.token_urlsafe(32)
        with db_cursor() as cur:
            if abierto:
                cur.execute(
                    """INSERT INTO users (email, name, shortcut_token) VALUES (%s, %s, %s)
                       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
                       RETURNING email, name, shortcut_token""",
                    (email, name, token),
                )
            else:
                cur.execute(
                    """UPDATE users SET name = %s WHERE email = %s
                       RETURNING email, name, shortcut_token""",
                    (name, email),
                )
            return cur.fetchone()
    row = await run_in_thread(_q)
    if not row:
        raise registro_cerrado_error()
    return dict(row)


async def get_all_users() -> list[dict]:
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT email, name FROM users")
            return cur.fetchall()
    rows = await run_in_thread(_q)
    return [dict(r) for r in rows]


async def get_email_by_shortcut_token(token: str) -> str | None:
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT email FROM users WHERE shortcut_token = %s", (token,))
            return cur.fetchone()
    row = await run_in_thread(_q)
    return row["email"] if row else None


async def get_or_create_shortcut_token(email: str) -> str | None:
    """Devuelve el shortcut_token del usuario; si es NULL (copia antigua) genera uno y
    lo guarda con UPDATE ... WHERE shortcut_token IS NULL (no pisa uno concurrente).
    None si el usuario no existe. Nunca se registra el token."""
    def _q():
        with db_cursor() as cur:
            cur.execute("SELECT shortcut_token FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
            if not row:
                return None
            if row["shortcut_token"]:
                return row["shortcut_token"]
            cur.execute(
                "UPDATE users SET shortcut_token = %s WHERE email = %s AND shortcut_token IS NULL "
                "RETURNING shortcut_token",
                (secrets.token_urlsafe(32), email),
            )
            upd = cur.fetchone()
            if upd:
                return upd["shortcut_token"]
            cur.execute("SELECT shortcut_token FROM users WHERE email = %s", (email,))
            again = cur.fetchone()
            return again["shortcut_token"] if again else None
    return await run_in_thread(_q)
