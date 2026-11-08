"""Importación de extractos del banco (CSV ya leído en el móvil).

El móvil parsea el CSV y manda filas {fecha, concepto, importe, tipo}. Aquí se
validan con las MISMAS reglas que el resto de altas (importe con `parse_importe`
de wallet.py, igual que /api/pending; fecha con `parse_fecha`; concepto ≤ 60;
tipo de la lista blanca), se detectan duplicados contra lo ya guardado
(misma fecha + importe + comercio) y, solo al confirmar, se insertan cifrados
(concepto_enc / importe_enc) en UNA transacción de BD.

Nada de esto registra en logs conceptos ni importes.
"""
from collections import Counter

from .db import db_cursor, run_in_thread
from .crypto import encrypt_str, encrypt_float, decrypt_transaction
from .importes import redondear_importe
from .wallet import parse_importe, parse_fecha
from . import legacy_plain

MAX_FILAS = 500            # filas por petición (el cliente trocea ficheros mayores)
CONCEPTO_MAX = 60
TIPOS = ("Ingreso", "Gasto Fijo", "Gasto Variable")


def clave_dup(fecha: str, importe: float, concepto: str) -> tuple:
    """Clave de comparación: día + céntimos + comercio sin mayúsculas ni espacios de más."""
    return (str(fecha)[:10], round(float(importe) * 100), " ".join(str(concepto).split()).casefold())


def validar_fila(raw) -> dict:
    """Valida UNA fila. Devuelve {fecha, concepto, importe, tipo} normalizada o
    {"error": motivo genérico}. Nunca incluye el valor recibido en el error."""
    if not isinstance(raw, dict):
        return {"error": "Fila inválida"}
    tipo = raw.get("tipo")
    if tipo not in TIPOS:
        return {"error": "Tipo inválido"}
    concepto = raw.get("concepto")
    if not isinstance(concepto, str):
        return {"error": "Falta el concepto"}
    concepto = " ".join(concepto.split())
    if not concepto:
        return {"error": "Falta el concepto"}
    if any(0xD800 <= ord(c) <= 0xDFFF for c in concepto):
        return {"error": "Texto inválido"}
    concepto = concepto[:CONCEPTO_MAX].rstrip()
    try:
        importe = parse_importe(raw.get("importe"))
    except ValueError:
        return {"error": "Importe inválido"}
    fecha_raw = raw.get("fecha")
    if not isinstance(fecha_raw, str) or not fecha_raw.strip():
        return {"error": "Falta la fecha"}  # en un extracto la fecha es obligatoria
    try:
        fecha = parse_fecha(fecha_raw).isoformat()
    except ValueError:
        return {"error": "Fecha inválida"}
    return {"fecha": fecha, "concepto": concepto, "importe": importe, "tipo": tipo}


def clasificar(filas: list, existentes: Counter) -> list[dict]:
    """Valida cada fila y marca duplicadas. `existentes` cuenta cuántos movimientos
    guardados hay por clave; cada fila del fichero consume uno (así dos cafés
    idénticos el mismo día solo se marcan duplicados si ya había dos guardados)."""
    restantes = Counter(existentes)
    out = []
    for i, raw in enumerate(filas):
        v = validar_fila(raw)
        if "error" in v:
            out.append({"i": i, "estado": "error", "error": v["error"]})
            continue
        k = clave_dup(v["fecha"], v["importe"], v["concepto"])
        if restantes[k] > 0:
            restantes[k] -= 1
            out.append({"i": i, "estado": "duplicada", **v})
        else:
            out.append({"i": i, "estado": "nueva", **v})
    return out


async def cargar_existentes(email: str, fechas: list[str]) -> Counter:
    """Cuenta los movimientos del usuario en el rango de fechas del fichero
    (descifrando en Python: concepto e importe no se pueden consultar en SQL)."""
    if not fechas:
        return Counter()
    desde, hasta = min(fechas), max(fechas)

    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT id, concepto_enc, importe_enc, fecha::text AS fecha FROM transactions "
                "WHERE user_email = %s AND fecha BETWEEN %s::date AND %s::date",
                (email, desde, hasta),
            )
            return cur.fetchall()

    c: Counter = Counter()
    for r in await run_in_thread(_q):
        dec = decrypt_transaction(r["concepto_enc"], r["importe_enc"], r["id"])
        if dec is None:
            continue
        c[clave_dup(r["fecha"], dec[1], dec[0])] += 1
    return c


async def previsualizar(email: str, filas: list) -> list[dict]:
    validas = [validar_fila(f) for f in filas]
    fechas = [v["fecha"] for v in validas if "error" not in v]
    return clasificar(filas, await cargar_existentes(email, fechas))


async def guardar(email: str, filas: list) -> dict:
    """Inserta las filas válidas y no duplicadas (la comprobación se repite aquí:
    nunca se confía en que el cliente haya filtrado). Una sola transacción."""
    clasif = await previsualizar(email, filas)
    nuevas = [r for r in clasif if r["estado"] == "nueva"]
    if nuevas:
        plain = legacy_plain.enabled()

        def _q():
            with db_cursor() as cur:
                for r in nuevas:
                    importe = redondear_importe(r["importe"])
                    cols = ["user_email", "tipo", "concepto_enc", "importe_enc", "fecha"]
                    vals = ["%s", "%s", "%s", "%s", "%s::date"]
                    params = [email, r["tipo"], encrypt_str(r["concepto"]), encrypt_float(importe), r["fecha"]]
                    if plain:  # TEMPORAL (B2): igual que post_transaction
                        cols += ["concepto", "importe"]
                        vals += ["%s", "%s"]
                        params += [r["concepto"], importe]
                    cur.execute(f"INSERT INTO transactions ({', '.join(cols)}) VALUES ({', '.join(vals)})", params)

        await run_in_thread(_q)
    return {
        "importadas": len(nuevas),
        "duplicadas": sum(1 for r in clasif if r["estado"] == "duplicada"),
        "errores": sum(1 for r in clasif if r["estado"] == "error"),
    }
