"""Semilla de QA — usuario de test + datos de muestra, con concepto/importe
cifrados (ver services/crypto.py). Sustituye a seed_qa.sql, que ya no vale
porque el cifrado se hace en la aplicación, no se puede expresar en SQL puro.

Requiere las variables de entorno DATABASE_URL, DB_ENCRYPTION_KEY y
QA_PASSWORD (contraseña del usuario de test, mínimo 10 caracteres). El repo es
público: ni la contraseña ni el shortcut_token se guardan en el código. El
shortcut_token se regenera aleatoriamente en cada ejecución.
Re-ejecutable: limpia los datos del usuario de test antes de insertar.

Uso:
    cd backend
    DATABASE_URL=... DB_ENCRYPTION_KEY=... QA_PASSWORD=... python seed_qa.py

Login de test →  email: qa@mieconomia.test   contraseña: la de QA_PASSWORD
"""
import os
import sys
import secrets
import psycopg2

sys.path.insert(0, os.path.dirname(__file__))
from services.crypto import encrypt_str, encrypt_float  # noqa: E402

EMAIL = "qa@mieconomia.test"
MIN_PASSWORD_LEN = 10


def read_qa_password() -> str:
    """Lee QA_PASSWORD del entorno; error claro si falta o es demasiado corta."""
    password = os.environ.get("QA_PASSWORD", "")
    if not password:
        raise SystemExit(
            "ERROR: define la variable de entorno QA_PASSWORD con la contraseña del "
            f"usuario de test ({EMAIL}), mínimo {MIN_PASSWORD_LEN} caracteres."
        )
    if len(password) < MIN_PASSWORD_LEN:
        raise SystemExit(
            f"ERROR: QA_PASSWORD debe tener al menos {MIN_PASSWORD_LEN} caracteres."
        )
    return password


def build_credentials() -> tuple[str, str]:
    """(password_hash, shortcut_token) para el usuario de test.
    El hash usa services.auth.hash_password (bcrypt), igual que el registro real."""
    password = read_qa_password()
    # services/auth.py exige JWT_SECRET al importarse, aunque la semilla no firma
    # ningún JWT: si no está definida se pone una aleatoria solo para este proceso.
    if not os.environ.get("JWT_SECRET"):
        os.environ["JWT_SECRET"] = secrets.token_urlsafe(48)
    from services.auth import hash_password  # noqa: E402 (import diferido)
    return hash_password(password), secrets.token_urlsafe(32)

# (fecha, tipo, concepto, importe)
TRANSACTIONS = [
    ("2026-05-01", "Ingreso",       "Nómina",  3200.00),
    ("2026-05-01", "Gasto Fijo",    "Piso",     800.00),
    ("2026-05-03", "Gasto Fijo",    "Netflix",   12.99),
    ("2026-05-06", "Gasto Variable","Comida",    32.40),
    ("2026-05-12", "Gasto Variable","Comida",    28.90),
    ("2026-05-18", "Gasto Variable","Ocio",      45.00),

    ("2026-06-01", "Ingreso",       "Nómina",  3200.00),
    ("2026-06-01", "Gasto Fijo",    "Piso",     800.00),
    ("2026-06-03", "Gasto Fijo",    "Netflix",   12.99),
    ("2026-06-07", "Gasto Variable","Comida",    35.10),
    ("2026-06-15", "Gasto Variable","Comida",    31.20),
    ("2026-06-20", "Gasto Variable","Ocio",      38.00),

    ("2026-07-01", "Ingreso",       "Nómina",  3200.00),
    ("2026-07-01", "Gasto Fijo",    "Piso",     800.00),
    ("2026-07-03", "Gasto Fijo",    "Netflix",   12.99),
    ("2026-07-05", "Gasto Variable","Comida",    34.50),
    ("2026-07-08", "Gasto Variable","Ocio",      60.00),
    ("2026-07-09", "Gasto Variable","Ropa",      75.00),
]

# (tipo, concepto, emoji) — categorías propias de muestra
CATEGORIES = [
    ("Gasto Variable", "Gimnasio", "🏋️"),
    ("Gasto Variable", "Mascotas", "🐶"),
    ("Ingreso",        "Freelance", "💻"),
]


def main():
    password_hash, shortcut_token = build_credentials()  # falla antes de tocar la BD
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO users (email, name, shortcut_token, password_hash) VALUES (%s, %s, %s, %s)
               ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
                                                  shortcut_token = EXCLUDED.shortcut_token""",
            (EMAIL, "QA Tester", shortcut_token, password_hash),
        )

        cur.execute("DELETE FROM transactions WHERE user_email = %s", (EMAIL,))
        cur.execute("DELETE FROM pending_transactions WHERE user_email = %s", (EMAIL,))

        for fecha, tipo, concepto, importe in TRANSACTIONS:
            cur.execute(
                """INSERT INTO transactions (user_email, fecha, tipo, concepto_enc, importe_enc)
                   VALUES (%s, %s::date, %s, %s, %s)""",
                (EMAIL, fecha, tipo, encrypt_str(concepto), encrypt_float(importe)),
            )

        # Categorías propias (nombre cifrado + HMAC para la unicidad). Se borran y
        # se reinsertan para que el script siga siendo re-ejecutable. Requiere que
        # el backend haya arrancado antes al menos una vez (crea las tablas).
        from services.crypto import hmac_tag  # noqa: E402
        cur.execute("DELETE FROM user_categories WHERE user_email = %s", (EMAIL,))
        for tipo, concepto, emoji in CATEGORIES:
            cur.execute(
                """INSERT INTO user_categories (user_email, tipo, concepto_enc, concepto_hmac, emoji)
                   VALUES (%s, %s, %s, %s, %s)""",
                (EMAIL, tipo, encrypt_str(concepto), hmac_tag(concepto.casefold()), emoji),
            )

        # Pago pendiente de categorizar (≈34,50€) → la app sugerirá "Comida".
        cur.execute(
            "INSERT INTO pending_transactions (user_email, importe, fecha) VALUES (%s, %s, %s::date)",
            (EMAIL, 34.50, "2026-07-10"),
        )

        conn.commit()
        print(f"✅ Semilla aplicada: usuario {EMAIL} + {len(TRANSACTIONS)} transacciones cifradas + {len(CATEGORIES)} categorías + 1 pendiente")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
