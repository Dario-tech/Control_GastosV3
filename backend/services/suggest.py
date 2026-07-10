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


def suggest_category(history: list[dict], importe: float) -> dict | None:
    """Devuelve la (tipo, concepto) más probable para un importe dado.

    Puntúa cada categoría del historial combinando:
      - frecuencia de uso (cuánto aparece la categoría)
      - cercanía del importe al importe medio de esa categoría
    Devuelve None si no hay historial suficiente.
    """
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

    if not groups:
        return None

    total = sum(len(v) for v in groups.values())
    best_key = None
    best_score = -1.0

    for key, amounts in groups.items():
        freq = len(amounts) / total
        mean = sum(amounts) / len(amounts)
        rel_diff = abs(mean - importe) / (mean + 1e-6)
        closeness = 1.0 / (1.0 + rel_diff)
        score = 0.6 * freq + 0.4 * closeness
        if score > best_score:
            best_score = score
            best_key = key

    if best_key is None:
        return None

    tipo, concepto = best_key
    return {
        "tipo":       tipo,
        "concepto":   concepto,
        "confidence": round(best_score, 2),
    }
