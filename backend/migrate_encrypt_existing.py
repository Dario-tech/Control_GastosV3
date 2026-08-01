"""Migración ÚNICA: cifra el concepto/importe de las transacciones ya
existentes en `transactions`, rellenando concepto_enc/importe_enc a partir
de las columnas en claro. No borra las columnas viejas — eso se hace en un
paso aparte, después de confirmar que el backend nuevo (que lee las
columnas cifradas) funciona bien en real.

Idempotente: solo toca filas donde concepto_enc todavía es NULL, así que se
puede volver a ejecutar sin duplicar trabajo si se corta a medias.

Uso:
    DATABASE_URL=... DB_ENCRYPTION_KEY=... python migrate_encrypt_existing.py
"""
import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, os.path.dirname(__file__))
from services.crypto import encrypt_str, decrypt_str, encrypt_float, decrypt_float  # noqa: E402


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS concepto_enc BYTEA")
        cur.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS importe_enc BYTEA")
        conn.commit()
        print("✅ Columnas concepto_enc / importe_enc listas")

        cur.execute("SELECT id, concepto, importe FROM transactions WHERE concepto_enc IS NULL")
        rows = cur.fetchall()
        print(f"Filas por migrar: {len(rows)}")

        for row in rows:
            concepto_enc = encrypt_str(row["concepto"])
            importe_enc = encrypt_float(float(row["importe"]))
            cur.execute(
                "UPDATE transactions SET concepto_enc = %s, importe_enc = %s WHERE id = %s",
                (concepto_enc, importe_enc, row["id"]),
            )
        conn.commit()
        print(f"✅ {len(rows)} filas cifradas y guardadas")

        # Verificación: descifrar cada fila y comparar con el valor original en claro.
        cur.execute("SELECT id, concepto, importe, concepto_enc, importe_enc FROM transactions")
        all_rows = cur.fetchall()
        mismatches = []
        for row in all_rows:
            if row["concepto_enc"] is None or row["importe_enc"] is None:
                mismatches.append((row["id"], "sin migrar"))
                continue
            dec_concepto = decrypt_str(bytes(row["concepto_enc"]))
            dec_importe = decrypt_float(bytes(row["importe_enc"]))
            if dec_concepto != row["concepto"] or abs(dec_importe - float(row["importe"])) > 0.001:
                mismatches.append((row["id"], f"esperado ({row['concepto']}, {row['importe']}) obtenido ({dec_concepto}, {dec_importe})"))

        if mismatches:
            print(f"❌ {len(mismatches)} filas no coinciden tras descifrar:")
            for m in mismatches:
                print(f"   id={m[0]}: {m[1]}")
            sys.exit(1)
        else:
            print(f"✅ Verificación OK: las {len(all_rows)} filas descifran exactamente igual que el valor en claro")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
