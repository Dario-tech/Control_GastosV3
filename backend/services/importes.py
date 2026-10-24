"""Normalización y validación de importes (euros) — punto único para todas las
escrituras de importe de transacciones y pendientes.

- IMPORTE_MAX: tope común (1.000.000). Cabe de sobra en `NUMERIC(10,2)` (la
  columna en claro de PROD, máx. 99.999.999,99) y en `NUMERIC(12,2)`.
- redondear_importe: 2 decimales con ROUND_HALF_UP sobre el decimal tal como
  se escribió (Decimal(str(float))), igual que redondea Postgres al guardar en
  NUMERIC(…,2). Se aplica ANTES de cifrar, así lo cifrado y lo escrito en claro
  (doble escritura B2) son siempre el mismo valor.
- validar_importe: número finito, > 0 y ≤ máximo tras redondear.

Ninguna función registra ni incluye en el error el valor recibido.
"""
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

IMPORTE_MAX = 1_000_000
_CENT = Decimal("0.01")


def redondear_importe(v) -> float:
    """Redondea a céntimos (ROUND_HALF_UP). ValueError si no es un número finito."""
    if isinstance(v, bool):
        raise ValueError("importe inválido")
    try:
        d = v if isinstance(v, Decimal) else Decimal(str(float(v)))
    except (TypeError, ValueError, OverflowError, InvalidOperation):
        raise ValueError("importe inválido")
    if not d.is_finite():
        raise ValueError("importe inválido")
    try:
        return float(d.quantize(_CENT, rounding=ROUND_HALF_UP))
    except InvalidOperation:  # demasiados dígitos (p. ej. 1e300)
        raise ValueError("importe inválido")


def validar_importe(v, maximo: float = IMPORTE_MAX) -> float:
    """Devuelve el importe redondeado a 2 decimales si es un número (no bool)
    finito, > 0 y ≤ maximo; si no, ValueError con mensaje genérico."""
    if isinstance(v, bool) or not isinstance(v, (int, float, Decimal)):
        raise ValueError("importe inválido")
    r = redondear_importe(v)
    if r <= 0 or r > maximo:
        raise ValueError("importe inválido")
    return r
