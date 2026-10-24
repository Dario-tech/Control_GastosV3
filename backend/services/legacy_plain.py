"""TEMPORAL — doble escritura de concepto/importe en claro (bloqueante B2 de
MIGRACION_QA_A_PROD.md, §3.2). Se elimina en la fase 3 del informe, cuando se
borren las columnas en claro de PRODUCCIÓN.

En PROD `transactions` conserva las columnas antiguas `concepto TEXT NOT NULL`
e `importe NUMERIC(10,2) NOT NULL` sin DEFAULT. El código solo lee de
`concepto_enc`/`importe_enc`, pero si no rellena también las columnas en
claro cada INSERT falla por NOT NULL. Además, mantenerlas al día permite
volver a la versión anterior (que solo lee las columnas en claro) sin
sincronizar nada.

Reglas:
- Se detecta UNA vez al arrancar (information_schema) si existen ambas.
- Si existen, toda escritura de concepto/importe de `transactions` escribe
  también el valor en claro, idéntico al cifrado.
- NUNCA se lee de las columnas en claro ni se hace DDL sobre ellas.
- En una BD creada con schema.sql no existen y no se escriben.

Apagado por configuración (sin borrar columnas): con LEGACY_PLAIN_WRITE=0 los
movimientos nuevos y editados se escriben SOLO cifrados y las columnas en claro
se dejan tal cual (los valores antiguos se conservan, no se tocan). Solo se
obedece si ambas columnas admiten NULL o tienen DEFAULT (si no, cada INSERT
fallaría): en ese caso se mantiene la doble escritura y se avisa. Antes hay que
ejecutar en la BD:  ALTER TABLE transactions ALTER COLUMN concepto DROP NOT NULL;
                    ALTER TABLE transactions ALTER COLUMN importe  DROP NOT NULL;
Volver atrás a una versión anterior del backend dejaría de ver los movimientos
creados con el interruptor apagado (solo lee las columnas en claro).
"""
import logging
import os

from .db import db_cursor

_log = logging.getLogger("uvicorn.error")

# False hasta que detect_plain_columns() diga lo contrario (y en los tests).
_enabled = False


def _apagado_por_config() -> bool:
    return os.getenv("LEGACY_PLAIN_WRITE", "1").strip().lower() in ("0", "false", "no", "off")


def detect_plain_columns() -> bool:
    """Mira si `transactions` tiene `concepto` e `importe` en claro y fija el
    modo de doble escritura. Se llama desde el lifespan de main.py."""
    global _enabled
    with db_cursor() as cur:
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND table_name = 'transactions' "
            "AND column_name IN ('concepto', 'importe')"
        )
        cols = {r["column_name"] for r in cur.fetchall()}
    _enabled = cols == {"concepto", "importe"}
    if _enabled and _apagado_por_config():
        with db_cursor() as cur:
            cur.execute(
                "SELECT column_name, is_nullable, column_default FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND table_name = 'transactions' "
                "AND column_name IN ('concepto', 'importe')"
            )
            info = cur.fetchall()
        sin_obligacion = len(info) == 2 and all(
            r["is_nullable"] == "YES" or r["column_default"] is not None for r in info)
        if sin_obligacion:
            _enabled = False
            _log.warning("transactions conserva concepto/importe en claro, pero la doble escritura está "
                         "APAGADA (LEGACY_PLAIN_WRITE=0): los movimientos nuevos se guardan solo cifrados")
            return False
        _log.warning("LEGACY_PLAIN_WRITE=0 ignorado: concepto/importe en claro son NOT NULL sin default; "
                     "hay que ejecutar ALTER COLUMN ... DROP NOT NULL antes de apagar la doble escritura")
    if _enabled:
        _log.warning("transactions tiene concepto/importe en claro: doble escritura TEMPORAL activa (B2)")
    elif cols:
        # Solo una de las dos: estado inesperado; no se escribe ninguna.
        _log.warning("transactions tiene solo una columna en claro (%s): doble escritura desactivada",
                     ", ".join(sorted(cols)))
    return _enabled


def enabled() -> bool:
    return _enabled


def set_enabled(value: bool) -> None:
    """Solo para tests."""
    global _enabled
    _enabled = bool(value)
