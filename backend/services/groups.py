"""Utilidades de reparto en céntimos (puras) y validación de texto/importe/fecha.

Antes era el módulo de «grupos» (Splitwise dentro de Ajustes); esa parte se retiró al integrar
los gastos compartidos en los movimientos (ver services/shared.py y docs-diseno-gastos-compartidos-v2.md).
Se conservan las funciones puras que reutiliza shared.py. Las tablas `expense_group*` y `group_*` de
schema.sql ya no se usan (quedan sin tocar para no perder datos de QA)."""
import logging
from fastapi import HTTPException

from .db import db_cursor  # noqa: F401  (compatibilidad con tests antiguos que parchean groups.db_cursor)
from .importes import validar_importe
from .wallet import parse_fecha

_log = logging.getLogger("uvicorn.error")

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


