"""Lógica pura (sin BD ni red) de los pendientes que llegan de Cartera / Apple Pay
(el Atajo abre la app con comercio + importe y la app los envía a POST /api/pending).

- parse_importe: convierte el importe tal como lo da Wallet ("12,30 €",
  "€12.30", "1.234,56 €", "EUR 12,30"...) en un float.
- normalize_merchant: normaliza el nombre del comercio antes de calcular su
  HMAC, para que "Mercadona S.A. 1234" y "MERCADONA" compartan regla.
- parse_fecha / today_madrid: la fecha por defecto es HOY en Europe/Madrid,
  calculada en Python (CURRENT_DATE de la BD va en UTC).

Ninguna función registra en logs la entrada (importe/comercio son datos privados).
"""
import math
import re
import unicodedata
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from .importes import redondear_importe, IMPORTE_MAX as _IMPORTE_MAX_COMUN

MADRID = ZoneInfo("Europe/Madrid")

# Más estricto que el tope común (importes.IMPORTE_MAX = 1.000.000): un pago de
# Wallet nunca es tan alto. Al categorizar se vuelve a validar con el común.
IMPORTE_MAX = 100_000
assert IMPORTE_MAX <= _IMPORTE_MAX_COMUN
COMERCIO_MAX = 120
ID_EXTERNO_MAX = 200
_IMPORTE_RAW_MAX = 64  # caracteres: el texto de Wallet nunca es más largo


# ── Fecha ─────────────────────────────────────────────────────────────────────

def now_utc() -> datetime:
    """Punto único de "ahora" (los tests lo sustituyen)."""
    return datetime.now(timezone.utc)


def today_madrid() -> date:
    return now_utc().astimezone(MADRID).date()


_FECHA_SOLO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_FECHA_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")


def parse_fecha(raw) -> date:
    """Acepta "YYYY-MM-DD" o ISO 8601 con hora. None/"" → hoy en Madrid.

    Con zona horaria (p. ej. "...Z" o "+02:00") se convierte a hora de Madrid
    antes de quedarse con el día; sin zona se toma el día tal cual.
    Lanza ValueError si el formato no es válido o el año está fuera de rango.
    """
    if raw is None:
        return today_madrid()
    if not isinstance(raw, str):
        raise ValueError("fecha inválida")
    s = raw.strip()
    if not s:
        return today_madrid()
    if len(s) > 40:
        raise ValueError("fecha inválida")
    if _FECHA_SOLO_RE.match(s):
        d = date.fromisoformat(s)
    elif _FECHA_ISO_RE.match(s):
        dt = datetime.fromisoformat(s.replace("z", "Z"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(MADRID)
        d = dt.date()
    else:
        raise ValueError("fecha inválida")
    hoy = today_madrid()
    if d.year < 2000 or d.year > hoy.year + 1:
        raise ValueError("fecha inválida")
    return d


# ── Importe ───────────────────────────────────────────────────────────────────

# Códigos y símbolos de moneda que Wallet puede anteponer o posponer.
_CURRENCY_RE = re.compile(r"(EUROS?|EUR|USD|GBP|€|\$|£)", re.IGNORECASE)
# Espacios normales, no separables (U+00A0), estrechos (U+202F), finos, etc.
_SPACES_RE = re.compile(r"[\s    ]+")
_SPACE_THOUSANDS_RE = re.compile(r"(?<=\d)[\s    ]+(\d+)")
_NUM_RE = re.compile(r"^\d[\d.,]*$")


def _validate(v: float, maximo: float = IMPORTE_MAX) -> float:
    if not math.isfinite(v):
        raise ValueError("importe inválido")
    v = redondear_importe(v)  # céntimos, ROUND_HALF_UP (mismo helper que el resto)
    if v <= 0 or v > maximo:
        raise ValueError("importe inválido")
    return v


def _parse_number_text(s: str) -> float:
    """s solo contiene dígitos, '.' y ','. Decide qué separador es el decimal."""
    if not _NUM_RE.match(s) or s[-1] in ".,":
        raise ValueError("importe inválido")
    has_dot, has_comma = "." in s, "," in s

    if has_dot and has_comma:
        # El último separador que aparece es el decimal; el otro, de miles.
        dec = "," if s.rfind(",") > s.rfind(".") else "."
        thou = "." if dec == "," else ","
        int_part, _, frac = s.rpartition(dec)
        if thou in frac or dec in int_part:
            raise ValueError("importe inválido")
        groups = int_part.split(thou)
        if not groups[0] or len(groups[0]) > 3 or any(len(g) != 3 for g in groups[1:]):
            raise ValueError("importe inválido")
        return float("".join(groups) + "." + frac)

    sep = "," if has_comma else ("." if has_dot else None)
    if sep is None:
        return float(s)
    parts = s.split(sep)
    if len(parts) > 2:
        # "1.234.567" → todos son separadores de miles
        if len(parts[0]) > 3 or any(len(g) != 3 for g in parts[1:]):
            raise ValueError("importe inválido")
        return float("".join(parts))
    int_part, frac = parts
    # Un único separador seguido de exactamente 3 dígitos ("1.234", "1,234") es
    # de miles: Wallet siempre muestra 2 decimales en euros. Excepción: "0,123".
    if len(frac) == 3 and int_part not in ("", "0"):
        return float(int_part + frac)
    return float(int_part + "." + frac)


def parse_importe(raw, maximo: float = IMPORTE_MAX) -> float:
    """Convierte el importe de Wallet en float finito, > 0 y ≤ IMPORTE_MAX.

    Acepta número (int/float, no bool) o texto: "12,30 €", "€12.30",
    "1.234,56 €", "12.30", "EUR 12,30", con espacios no separables, etc.
    Lanza ValueError("importe inválido") en cualquier otro caso (incluidos
    negativos: un reembolso no es un gasto).
    """
    if isinstance(raw, bool) or raw is None:
        raise ValueError("importe inválido")
    if isinstance(raw, (int, float)):
        try:
            return _validate(float(raw), maximo)
        except OverflowError:
            raise ValueError("importe inválido")
    if not isinstance(raw, str) or len(raw) > _IMPORTE_RAW_MAX:
        raise ValueError("importe inválido")
    s = _CURRENCY_RE.sub("", raw)
    # Un espacio entre dígitos solo vale como separador de miles ("1 234,56"):
    # "12 30" no es un importe.
    if any(len(m.group(1)) != 3 for m in _SPACE_THOUSANDS_RE.finditer(s.strip())):
        raise ValueError("importe inválido")
    s = _SPACES_RE.sub("", s)
    if s.startswith("+"):
        s = s[1:]
    if not s:
        raise ValueError("importe inválido")
    return _validate(_parse_number_text(s), maximo)


# ── Comercio ──────────────────────────────────────────────────────────────────

def clean_comercio(raw) -> str | None:
    """strip + recorte a COMERCIO_MAX; vacío o no-texto → None."""
    if not isinstance(raw, str):
        return None
    s = _SPACES_RE.sub(" ", raw).strip()
    if not s:
        return None
    return s[:COMERCIO_MAX].rstrip() or None


# Formas jurídicas que se eliminan al final del nombre (ya sin puntos).
_LEGAL_SUFFIXES = {
    "SA", "SL", "SLU", "SAU", "SLL", "SLNE", "SC", "SCP", "CB", "SCOOP", "COOP",
    "INC", "LTD", "LLC", "GMBH", "BV", "SRL", "SPA", "SAS", "CORP", "CO", "PLC",
}


def normalize_merchant(raw) -> str:
    """Forma canónica del comercio para el HMAC de las reglas aprendidas.

    Mayúsculas, sin acentos, sin puntuación, sin números de tienda (tokens solo
    numéricos, p. ej. "1234" o "#0456") ni formas jurídicas finales ("S.A.",
    "S.L.", "SLU"...), con espacios colapsados. Puede devolver "" (sin regla).
    """
    if not isinstance(raw, str):
        return ""
    s = unicodedata.normalize("NFKD", raw)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.upper().replace(".", "")
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    tokens = [t for t in s.split() if not t.isdigit()]
    while tokens and tokens[-1] in _LEGAL_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def clean_id_externo(raw) -> str | None:
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        raw = str(raw)
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    return s[:ID_EXTERNO_MAX] or None
