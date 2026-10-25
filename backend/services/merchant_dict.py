"""Sugerencia de categoría a partir del NOMBRE del comercio, con el diccionario
integrado de data/comercios_es.py (comercios y cadenas de España).

Lógica pura: sin BD ni red. Pasos:
  1. Limpia el nombre sucio de Apple Pay con wallet.normalize_merchant
     ("ZARA 0123 MADRID", "PAYPAL *SPOTIFY", "AMZN Mktp ES"...).
  2. Busca el alias que mejor encaja, por PALABRAS completas (nunca por trozos
     sueltos: "BP" no casa con "BPIFRANCE"). Gana el alias con más palabras,
     luego el más largo y luego el que aparece antes en el nombre.
  3. Del grupo del comercio elige la primera categoría candidata que el usuario
     TENGA VISIBLE (por defecto o propia, y no oculta). Si no tiene ninguna, no
     sugiere nada y se sigue con el historial.
"""
import re
import unicodedata
from dataclasses import dataclass

from data.comercios_es import DEFAULT_CATEGORIES, GRUPOS, TEXTO
from .wallet import normalize_merchant

TIPOS_GASTO = ("Gasto Variable", "Gasto Fijo")
CONFIANZA = 0.8  # menor que una regla aprendida (1.0)

# "zara.com", "amazon.es", "apple.com/bill": el dominio no aporta nada y el punto
# pegaría las palabras al normalizar.
_DOMINIO_RE = re.compile(r"\.(com|es|net|org|eu|io|co|app|tv|fm)\b", re.IGNORECASE)
_SUFIJO_NUM_RE = re.compile(r"^([A-Z]{3,})\d+$")  # "ZARA0123" -> "ZARA"


def _tokens(raw) -> list[str]:
    if not isinstance(raw, str):
        return []
    s = _DOMINIO_RE.sub(" ", raw)
    out = []
    for t in normalize_merchant(s).split():
        m = _SUFIJO_NUM_RE.match(t)
        out.append(m.group(1) if m else t)
    return out


def norm_categoria(nombre) -> str:
    """Nombre de categoría para comparar: sin tildes, sin mayúsculas, espacios colapsados
    (igual que normalizeCategoryName del frontend)."""
    s = unicodedata.normalize("NFD", str(nombre or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.split()).lower()


@dataclass(frozen=True)
class _Alias:
    tokens: tuple[str, ...]
    anclado: bool   # solo vale si el nombre EMPIEZA por el alias
    grupo: str
    generico: bool = False  # palabra genérica ("farmacia"), no una marca

    @property
    def especificidad(self) -> tuple[int, int]:
        return (len(self.tokens), sum(len(t) for t in self.tokens))


def _cargar() -> dict[str, list[_Alias]]:
    """TEXTO -> índice por primera palabra del alias. Falla al importar si hay un
    grupo inexistente o el mismo alias en dos grupos distintos."""
    indice: dict[str, list[_Alias]] = {}
    vistos: dict[tuple, str] = {}
    for n, linea in enumerate(TEXTO.splitlines(), 1):
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        if "=>" not in linea:
            raise ValueError(f"comercios_es: línea sin '=>' ({linea[:40]!r})")
        izq, _, grupo = linea.rpartition("=>")
        grupo = grupo.strip()
        if grupo not in GRUPOS:
            raise ValueError(f"comercios_es: grupo desconocido {grupo!r}")
        for raw in izq.split("|"):
            raw = raw.strip()
            marcas = raw[:len(raw) - len(raw.lstrip("^~"))]
            anclado, generico = "^" in marcas, "~" in marcas
            toks = tuple(_tokens(raw.lstrip("^~").strip()))
            if not toks:
                continue
            clave = (toks, anclado)
            if clave in vistos:
                if vistos[clave] != grupo:
                    raise ValueError(f"comercios_es: alias repetido en dos grupos: {' '.join(toks)}")
                continue
            vistos[clave] = grupo
            indice.setdefault(toks[0], []).append(_Alias(toks, anclado, grupo, generico))
    return indice


_INDICE = _cargar()


def _mejor_alias(comercio) -> _Alias | None:
    toks = _tokens(comercio)
    mejor = None  # (especificidad, -posición, alias)
    for i, t in enumerate(toks):
        for a in _INDICE.get(t, ()):
            n = len(a.tokens)
            if a.anclado and i != 0:
                continue
            if tuple(toks[i:i + n]) != a.tokens:
                continue
            clave = (a.especificidad, -i)
            if mejor is None or clave > mejor[0]:
                mejor = (clave, a)
    return mejor[1] if mejor else None


def match_comercio(comercio) -> str | None:
    """Grupo del diccionario para este nombre de comercio, o None."""
    a = _mejor_alias(comercio)
    return a.grupo if a else None


def clave_marca(comercio) -> str | None:
    """Nombre canónico de la marca reconocida ("ZARA", "MERCADONA"...), o None.
    Sirve para que lo que el usuario aprende de «ZARA MADRID» valga también para
    «ZARA 0123 BARCELONA». None para palabras genéricas ("FARMACIA LOPEZ")."""
    a = _mejor_alias(comercio)
    return " ".join(a.tokens) if a and not a.generico else None


def categorias_visibles(propias, ocultas) -> dict[str, list[tuple[str, str]]]:
    """nombre normalizado -> [(tipo, nombre a mostrar)] solo de gastos.
    Por defecto menos las ocultas, más las propias del usuario."""
    ocultas_k = {(o.get("tipo"), norm_categoria(o.get("concepto")))
                 for o in (ocultas or []) if isinstance(o, dict)}
    vis: dict[str, list[tuple[str, str]]] = {}
    for tipo, nombres in DEFAULT_CATEGORIES.items():
        for nombre in nombres:
            if (tipo, norm_categoria(nombre)) not in ocultas_k:
                vis.setdefault(norm_categoria(nombre), []).append((tipo, nombre))
    for c in propias or []:
        tipo, nombre = c.get("tipo"), c.get("concepto")
        if tipo not in TIPOS_GASTO or not nombre:
            continue
        lista = vis.setdefault(norm_categoria(nombre), [])
        if (tipo, nombre) not in lista and tipo not in [t for t, _ in lista]:
            lista.append((tipo, nombre))
    return vis


def suggest_from_dictionary(comercio, propias=(), ocultas=()) -> dict | None:
    """{"tipo","concepto","confidence","origen":"diccionario"} o None.

    propias / ocultas: listas de {"tipo","concepto"} (categorías propias del
    usuario y categorías por defecto que tiene ocultas)."""
    grupo = match_comercio(comercio)
    if grupo is None:
        return None
    tipo_pref, candidatas = GRUPOS[grupo]
    vis = categorias_visibles(propias, ocultas)
    for cand in candidatas:
        opciones = vis.get(norm_categoria(cand))
        if not opciones:
            continue
        elegida = next((o for o in opciones if o[0] == tipo_pref), opciones[0])
        return {"tipo": elegida[0], "concepto": elegida[1],
                "confidence": CONFIANZA, "origen": "diccionario"}
    return None
