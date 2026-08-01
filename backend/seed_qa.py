"""Semilla de QA — usuario de test + datos de muestra, con concepto/importe
cifrados (ver services/crypto.py). Sustituye a seed_qa.sql, que ya no vale
porque el cifrado se hace en la aplicación, no se puede expresar en SQL puro.

Requiere las variables de entorno DATABASE_URL y DB_ENCRYPTION_KEY.
Re-ejecutable: limpia los datos del usuario de test antes de insertar.

Uso:
    cd backend
    DATABASE_URL=... DB_ENCRYPTION_KEY=... python seed_qa.py

Login de test →  email: qa@mieconomia.test   contraseña: QaTest1234!
"""
import os
import sys
import psycopg2

sys.path.insert(0, os.path.dirname(__file__))
from services.crypto import encrypt_str, encrypt_float  # noqa: E402

EMAIL = "qa@mieconomia.test"
# bcrypt (cost 12) de "QaTest1234!"
PASSWORD_HASH = "$2b$12$ZOxOt1mTOEQkgdM0M4280./030CE2uomJR2Lr57Sd881gekEmltya"

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


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO users (email, name, shortcut_token, password_hash) VALUES (%s, %s, %s, %s)
               ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash""",
            (EMAIL, "QA Tester", "BlsAlWmj1igk6ICuLA9qncvOThYGyARiRj_6v9Fb_qQ", PASSWORD_HASH),
        )

        cur.execute("DELETE FROM transactions WHERE user_email = %s", (EMAIL,))
        cur.execute("DELETE FROM pending_transactions WHERE user_email = %s", (EMAIL,))

        for fecha, tipo, concepto, importe in TRANSACTIONS:
            cur.execute(
                """INSERT INTO transactions (user_email, fecha, tipo, concepto_enc, importe_enc)
                   VALUES (%s, %s::date, %s, %s, %s)""",
                (EMAIL, fecha, tipo, encrypt_str(concepto), encrypt_float(importe)),
            )

        # Pago pendiente de categorizar (≈34,50€) → la app sugerirá "Comida".
        cur.execute(
            "INSERT INTO pending_transactions (user_email, importe, fecha) VALUES (%s, %s, %s::date)",
            (EMAIL, 34.50, "2026-07-10"),
        )

        conn.commit()
        print(f"✅ Semilla aplicada: usuario {EMAIL} + {len(TRANSACTIONS)} transacciones cifradas + 1 pendiente")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
