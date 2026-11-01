"""Sugerencia de categoría para transacciones pendientes.

Las pendientes que llegan del Atajo solo traen importe y fecha (sin descripción),
así que la mejor señal disponible es el historial del propio usuario:
qué categorías usa más y con qué importes típicos. Esto pre-selecciona la
categoría más probable para que categorizar sea un solo toque.

Sin dependencias externas ni cambios de esquema.
"""
from collections import defaultdict

# Ids canónicos de tipo (deben coincidir con TYPES del frontend)
TIPO_VARIABLE = "Gasto Variable"
TIPO_FIJO     = "Gasto Fijo"
TIPO_INGRESO  = "Ingreso"


def _normalize_tipo(raw: str) -> str:
    """Lleva cualquier variante histórica de tipo a uno de los tres ids canónicos."""
    s = str(raw or "").upper()
    if "INGRESO" in s:
        return TIPO_INGRESO
    if "FIJO" in s:
        return TIPO_FIJO
    return TIPO_VARIABLE


def build_category_groups(history: list[dict]) -> tuple[list[tuple[str, str, int, float]], int]:
    """Agrupa el historial UNA vez: [(tipo, concepto, nº de movimientos, importe medio)]
    en orden de primera aparición (importante: el desempate del mejor gana el primero)
    y el total de movimientos válidos. Coste H; luego cada sugerencia cuesta solo G
    (nº de categorías distintas), no H."""
    groups: dict[tuple[str, str], list[float]] = defaultdict(list)
    for r in history:
        tipo     = _normalize_tipo(r.get("tipo"))
        concepto = str(r.get("concepto", "") or "").strip()
        if not concepto:
            continue
        try:
            amt = abs(float(r.get("importe", 0) or 0))
        except (TypeError, ValueError):
            continue
        groups[(tipo, concepto)].append(amt)

    total = sum(len(v) for v in groups.values())
    return [(t, c, len(v), sum(v) / len(v)) for (t, c), v in groups.items()], total


def suggest_from_groups(groups: list[tuple[str, str, int, float]], total: int, importe: float) -> dict | None:
    """Misma puntuación que siempre, sobre grupos ya construidos."""
    if not groups:
        return None
    best = None
    best_score = -1.0
    for tipo, concepto, n, mean in groups:
        freq = n / total
        rel_diff = abs(mean - importe) / (mean + 1e-6)
        closeness = 1.0 / (1.0 + rel_diff)
        score = 0.6 * freq + 0.4 * closeness
        if score > best_score:
            best_score = score
            best = (tipo, concepto)
    if best is None:
        return None
    return {"tipo": best[0], "concepto": best[1], "confidence": round(best_score, 2)}


def suggest_category(history: list[dict], importe: float) -> dict | None:
    """Devuelve la (tipo, concepto) más probable para un importe dado.

    Puntúa cada categoría del historial combinando:
      - frecuencia de uso (cuánto aparece la categoría)
      - cercanía del importe al importe medio de esa categoría
    Devuelve None si no hay historial suficiente.
    Para varias sugerencias sobre el mismo historial, usa build_category_groups una
    vez y suggest_from_groups por cada importe.
    """
    groups, total = build_category_groups(history)
    return suggest_from_groups(groups, total, importe)
