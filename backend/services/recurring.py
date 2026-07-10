"""Detección de gastos recurrentes / suscripciones.

Analiza el historial del usuario (solo lectura) y detecta conceptos que se
repiten con un importe estable y a intervalos regulares (semanal, mensual,
anual…). Sirve para avisar de suscripciones olvidadas — la función estrella
de apps como Fintonic.

Sin dependencias externas ni cambios de esquema.
"""
import statistics
from datetime import datetime, timedelta
from collections import defaultdict

from .db import db_cursor, run_in_thread

# (mín días, máx días, etiqueta, período canónico) para clasificar el hueco entre cargos
_FREQUENCIES = [
    (6,   8,   "semanal",    7),
    (13,  16,  "quincenal",  15),
    (25,  35,  "mensual",    30),
    (85,  95,  "trimestral", 90),
    (350, 380, "anual",      365),
]

# Nº mínimo de cargos para considerar un patrón fiable (evita falsos positivos)
_MIN_OCCURRENCES = 3


def _parse_date(value) -> datetime | None:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d")
    except (TypeError, ValueError):
        return None


def detect_recurring(history: list[dict]) -> list[dict]:
    """Devuelve la lista de gastos recurrentes detectados, de mayor a menor importe."""
    # Agrupa por concepto + importe redondeado al euro (una suscripción cobra lo mismo)
    groups: dict[tuple[str, int], list[tuple[datetime, float]]] = defaultdict(list)
    for r in history:
        concepto = str(r.get("concepto", "") or "").strip()
        if not concepto:
            continue
        try:
            amt = abs(float(r.get("importe", 0) or 0))
        except (TypeError, ValueError):
            continue
        d = _parse_date(r.get("fecha"))
        if d is None:
            continue
        groups[(concepto, round(amt))].append((d, amt))

    results = []
    for (concepto, _bucket), items in groups.items():
        if len(items) < _MIN_OCCURRENCES:
            continue
        items.sort(key=lambda x: x[0])
        dates = [d for d, _ in items]
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        gaps = [g for g in gaps if g > 0]
        if not gaps:
            continue

        median_gap = statistics.median(gaps)
        label, period = None, None
        for lo, hi, name, canonical in _FREQUENCIES:
            if lo <= median_gap <= hi:
                label, period = name, canonical
                break
        if label is None:
            continue

        typical = round(statistics.median([a for _, a in items]), 2)
        last = dates[-1]
        results.append({
            "concepto":    concepto,
            "importe":     typical,
            "frecuencia":  label,
            "ocurrencias": len(items),
            "ultima":      last.strftime("%Y-%m-%d"),
            "proxima":     (last + timedelta(days=period)).strftime("%Y-%m-%d"),
        })

    results.sort(key=lambda x: x["importe"], reverse=True)
    return results


async def get_recurring(email: str) -> list[dict]:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                "SELECT concepto, importe, fecha::text FROM transactions WHERE user_email = %s",
                (email,),
            )
            return cur.fetchall()
    rows = await run_in_thread(_q)
    return detect_recurring([dict(r) for r in rows])
