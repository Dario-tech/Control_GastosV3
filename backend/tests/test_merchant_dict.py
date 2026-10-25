"""Diccionario de comercios (services/merchant_dict.py + data/comercios_es.py):
nombres sucios de Apple Pay -> categoría, falsos positivos, elección de la
categoría candidata según las que tenga el usuario, coherencia de los datos y
que no hay llamadas de red. Solo comercios públicos de ejemplo."""
import re
import socket
from pathlib import Path

import pytest

from data.comercios_es import DEFAULT_CATEGORIES, GRUPOS, TEXTO
from services.merchant_dict import (
    _INDICE, categorias_visibles, match_comercio, norm_categoria, suggest_from_dictionary,
)

V, F = "Gasto Variable", "Gasto Fijo"


def sug(comercio, propias=(), ocultas=()):
    r = suggest_from_dictionary(comercio, propias, ocultas)
    return (r["tipo"], r["concepto"]) if r else None


# ── Nombres sucios -> categoría (solo categorías por defecto) ─────────────────

@pytest.mark.parametrize("nombre,esperado", [
    # supermercados
    ("MERCADONA", (V, "Comida")), ("Mercadona C. Gran Via", (V, "Comida")),
    ("MERCADONA S.A. 0042", (V, "Comida")), ("mercadona,sa", (V, "Comida")),
    ("ALCAMPO S.A. 2387", (V, "Comida")), ("ALCAMPO MADRID", (V, "Comida")),
    ("CARREFOUR EXPRESS 1234", (V, "Comida")), ("Carrefour Market Sevilla", (V, "Comida")),
    ("LIDL ESPANA 0456", (V, "Comida")), ("ALDI SUPERMARKT", (V, "Comida")),
    ("DIA TIENDA 1234", (V, "Comida")), ("Supermercados DIA", (V, "Comida")),
    ("EROSKI CENTER BILBAO", (V, "Comida")), ("CONSUM COOP V 1020", (V, "Comida")),
    ("HIPERCOR PINAR", (V, "Comida")), ("Bonpreu i Esclat", (V, "Comida")),
    ("SUPERMERCADO EL ROSAL", (V, "Comida")), ("PANADERIA LA ESPIGA", (V, "Comida")),
    # restauración
    ("MCDONALD'S 0123", (V, "Comida")), ("MCDONALDS MADRID", (V, "Comida")),
    ("BURGER KING 4567", (V, "Comida")), ("TELEPIZZA 0321 MALAGA", (V, "Comida")),
    ("Domino's Pizza", (V, "Comida")), ("GLOVO*PEDIDO", (V, "Comida")),
    ("UBER *EATS", (V, "Comida")), ("UBER EATS HELP.UBER.COM", (V, "Comida")),
    ("JUST EAT", (V, "Comida")), ("STARBUCKS 12345", (V, "Comida")),
    ("RESTAURANTE LA PLAZA", (V, "Comida")), ("BAR EL RINCON", (V, "Comida")),
    ("PIZZERIA DA MARIO", (V, "Comida")), ("100 MONTADITOS 2201", (V, "Comida")),
    # ropa
    ("ZARA 0123 MADRID", (V, "Ropa")), ("ZARA.COM", (V, "Ropa")), ("ZARA0123", (V, "Ropa")),
    ("Bershka", (V, "Ropa")), ("PULL&BEAR 0099", (V, "Ropa")), ("H&M HENNES & MAURITZ", (V, "Ropa")),
    ("PRIMARK GRAN VIA", (V, "Ropa")), ("MANGO 0451 BARCELONA", (V, "Ropa")),
    ("MASSIMO DUTTI", (V, "Ropa")), ("ZALANDO PAYMENTS", (V, "Ropa")), ("SHEIN.COM", (V, "Ropa")),
    ("NIKE STORE", (V, "Ropa")),
    # gasolina y coche
    ("REPSOL EST SERV 0123", (F, "Transporte")), ("Repsol", (F, "Transporte")),
    ("CEPSA E.S. LA MORALEJA", (F, "Transporte")), ("SHELL MADRID", (F, "Transporte")),
    ("BP OIL ESPANA", (F, "Transporte")), ("GALP ALCOBENDAS", (F, "Transporte")),
    ("BALLENOIL ALCALA", (F, "Transporte")), ("GASOLINERA LA RIBERA", (F, "Transporte")),
    ("EMPARK APARCAMIENTOS", (F, "Transporte")), ("SABA PARKING", (F, "Transporte")),
    # transporte
    ("RENFE VIAJEROS", (F, "Transporte")), ("METRO DE MADRID", (F, "Transporte")),
    ("CABIFY ESPANA", (F, "Transporte")), ("UBER *TRIP", (F, "Transporte")),
    ("FREE NOW", (F, "Transporte")), ("TMB BARCELONA", (F, "Transporte")),
    ("ALSA", (F, "Transporte")), ("BLABLACAR", (F, "Transporte")),
    # suscripciones
    ("NETFLIX.COM", (V, "Suscripciones")), ("PAYPAL *SPOTIFY", (V, "Suscripciones")),
    ("SPOTIFY P1A2B3", (V, "Suscripciones")), ("APPLE.COM/BILL", (V, "Suscripciones")),
    ("GOOGLE *YOUTUBE PREMIUM", (V, "Suscripciones")), ("DISNEY PLUS", (V, "Suscripciones")),
    ("HBO MAX", (V, "Suscripciones")), ("AMAZON PRIME*2K4", (V, "Suscripciones")),
    ("OPENAI *CHATGPT SUBSCR", (V, "Suscripciones")), ("MICROSOFT 365", (V, "Suscripciones")),
    ("DROPBOX", (V, "Suscripciones")), ("ICLOUD", (V, "Suscripciones")),
    ("MOVISTAR PLUS+", (V, "Suscripciones")), ("DAZN", (V, "Suscripciones")),
    # vuelos y viajes
    ("RYANAIR 0000", (V, "Vuelos")), ("VUELING AIRLINES", (V, "Vuelos")),
    ("IBERIA LINEAS AEREAS", (V, "Vuelos")), ("EASYJET", (V, "Vuelos")),
    ("BOOKING.COM", (V, "Ocio")), ("AIRBNB * HM123", (V, "Ocio")),
    # gimnasios
    ("BASIC-FIT SPAIN", (V, "Gimnasio")), ("ALTAFIT", (V, "Gimnasio")),
    ("VIVA GYM BARCELONA", (V, "Gimnasio")), ("MCFIT", (V, "Gimnasio")),
    # telefonía y suministros
    ("MOVISTAR", (F, "Wifi")), ("VODAFONE ESPANA", (F, "Wifi")), ("ORANGE ESPAGNE", (F, "Wifi")),
    ("DIGI SPAIN", (F, "Wifi")), ("IBERDROLA CLIENTES", (F, "Luz")), ("ENDESA ENERGIA", (F, "Luz")),
    ("NATURGY IBERIA", (F, "Luz")), ("CANAL DE ISABEL II", (F, "Agua")),
    # inversión
    ("TRADE REPUBLIC", (F, "Inversiones")), ("COINBASE", (F, "Cripto")),
    ("DEGIRO", (F, "Inversiones")), ("Bit2Me", (F, "Cripto")),
    # compras, hogar, tecnología, ocio, otros
    ("AMZN Mktp ES", (V, "Variado")), ("AMAZON.ES", (V, "Variado")), ("AMAZON EU SARL", (V, "Variado")),
    ("EL CORTE INGLES 0023", (V, "Variado")), ("ALIEXPRESS", (V, "Variado")),
    ("IKEA IBERICA", (V, "Variado")), ("LEROY MERLIN 0012", (V, "Variado")),
    ("ZARA HOME", (V, "Variado")), ("MEDIAMARKT", (V, "Variado")), ("PCCOMPONENTES", (V, "Variado")),
    ("FARMACIA LOPEZ", (V, "Variado")), ("SEPHORA", (V, "Variado")), ("KIWOKO", (V, "Variado")),
    ("ESTANCO 12", (V, "Variado")), ("UDEMY", (V, "Variado")),
    ("CINESA", (V, "Ocio")), ("YELMO CINES", (V, "Ocio")), ("TICKETMASTER", (V, "Ocio")),
    ("STEAM GAMES", (V, "Ocio")), ("FNAC", (V, "Ocio")), ("DECATHLON", (V, "Ocio")),
])
def test_nombres_sucios_de_apple_pay(nombre, esperado):
    assert sug(nombre) == esperado


def test_resultado_incluye_origen_y_confianza():
    r = suggest_from_dictionary("Zara", [], [])
    assert r == {"tipo": V, "concepto": "Ropa", "confidence": 0.8, "origen": "diccionario"}


# ── Falsos positivos: no deben casar ──────────────────────────────────────────

@pytest.mark.parametrize("nombre", [
    "BPIFRANCE", "BPI FINANCIAL", "ZARAGOZA BAR", "ZARAGOZA TRANSPORTES", "ZARAUTZ",
    "MENU DEL DIA", "BUEN DIA SL", "DIAGNOSTICOS MEDICOS", "DIAMANTES SL",
    "BARCELONA TURISMO", "BARRIO NORTE", "SHELLEY GARCIA", "MANGOSTINO",
    "ALDEA DEL PINO", "NIKEL Y COBRE", "TAXIDERMIA", "REPSOLIDARIA", "LIDLE",
    "ORANGERIE SL", "AVIATION CLUB", "GAMELAN MUSICA", "DIGITAL ART", "SPARTAN GYM",
    "SUBWAYS INC", "ANTONIO LOPEZ", "TALLER PACO", "", "   ", "12345", "***",
])
def test_falsos_positivos_no_casan(nombre):
    assert match_comercio(nombre) is None
    assert suggest_from_dictionary(nombre, [], []) is None


@pytest.mark.parametrize("nombre", [None, 5, ["zara"], {"a": 1}])
def test_entrada_no_texto_no_casa(nombre):
    assert match_comercio(nombre) is None


@pytest.mark.parametrize("nombre", ["MI BP", "EL H&M DE JUAN", "TIENDA H&M", "VENTA DIA", "COMPRA AVIA"])
def test_alias_anclados_solo_valen_al_inicio(nombre):
    assert match_comercio(nombre) is None


@pytest.mark.parametrize("nombre", ["BP", "BP GASOLINERA", "H&M", "DIA", "AVIA"])
def test_alias_anclados_valen_al_inicio(nombre):
    assert match_comercio(nombre) is not None


def test_desempate_por_especificidad():
    assert match_comercio("ZARA HOME MADRID") == "hogar"      # 2 palabras gana a "zara"
    assert match_comercio("ZARA MADRID") == "ropa"
    assert match_comercio("UBER EATS") == "delivery"          # gana a "uber"
    assert match_comercio("UBER") == "taxi"
    assert match_comercio("AMAZON PRIME VIDEO") == "streaming"  # gana a "amazon"
    assert match_comercio("AMAZON") == "compras"
    assert match_comercio("MOVISTAR PLUS") == "streaming"     # gana a "movistar"
    assert match_comercio("MOVISTAR") == "telefonia"


# ── Elección de la categoría según las que tenga el usuario ───────────────────

def test_usa_la_propia_antes_que_la_por_defecto():
    propias = [{"tipo": V, "concepto": "Supermercado"}]
    assert sug("Mercadona", propias) == (V, "Supermercado")


def test_propia_con_otro_tipo_y_mayusculas_y_tildes():
    propias = [{"tipo": F, "concepto": "GASOLINA"}]
    assert sug("Repsol", propias) == (F, "GASOLINA")
    propias = [{"tipo": V, "concepto": "Gasolina"}]
    assert sug("Repsol", propias) == (V, "Gasolina")
    propias = [{"tipo": V, "concepto": "  Cafetería "}]
    assert sug("Starbucks", propias) == (V, "  Cafetería ")


def test_sin_propia_cae_a_la_categoria_por_defecto():
    assert sug("Mercadona", [{"tipo": V, "concepto": "Mascotas"}]) == (V, "Comida")


def test_respeta_el_orden_de_preferencia():
    propias = [{"tipo": V, "concepto": "Alimentación"}, {"tipo": V, "concepto": "Supermercado"}]
    assert sug("Lidl", propias) == (V, "Supermercado")  # Supermercado va antes que Alimentación


def test_categoria_oculta_no_se_sugiere():
    ocultas = [{"tipo": V, "concepto": "Comida"}]
    assert sug("Mercadona", [], ocultas) is None
    assert sug("Mercadona", [{"tipo": V, "concepto": "Supermercado"}], ocultas) == (V, "Supermercado")


def test_oculta_con_otro_formato_de_nombre():
    assert sug("Zara", [], [{"tipo": V, "concepto": " ROPA "}]) is None


def test_oculta_de_otro_tipo_no_afecta():
    assert sug("Zara", [], [{"tipo": F, "concepto": "Ropa"}]) == (V, "Ropa")


def test_propia_con_el_nombre_de_una_oculta_vuelve_a_estar_visible():
    ocultas = [{"tipo": V, "concepto": "Comida"}]
    propias = [{"tipo": V, "concepto": "comida"}]
    assert sug("Mercadona", propias, ocultas) == (V, "comida")


def test_ignora_propias_de_ingreso_y_basura():
    propias = [{"tipo": "Ingreso", "concepto": "Supermercado"}, {"tipo": V, "concepto": ""},
               {"tipo": V}, {"tipo": "Otro", "concepto": "Supermercado"}]
    assert sug("Mercadona", propias) == (V, "Comida")
    assert suggest_from_dictionary("Mercadona", None, None)["concepto"] == "Comida"
    assert suggest_from_dictionary("Mercadona", [], ["no es dict", None])["concepto"] == "Comida"


def test_seguros_solo_si_el_usuario_tiene_categoria_de_seguros():
    assert sug("MAPFRE ESPANA") is None
    assert sug("Mapfre", [{"tipo": F, "concepto": "Seguros"}]) == (F, "Seguros")


def test_viajes_prefiere_propia_al_ocio():
    assert sug("Booking.com", [{"tipo": V, "concepto": "Viajes"}]) == (V, "Viajes")
    assert sug("Ryanair", [{"tipo": V, "concepto": "Viajes"}]) == (V, "Vuelos")        # Vuelos por defecto va antes
    assert sug("Ryanair", [{"tipo": V, "concepto": "Viajes"}], [{"tipo": V, "concepto": "Vuelos"}]) == (V, "Viajes")


def test_categorias_visibles_no_incluye_ingresos():
    vis = categorias_visibles([], [])
    assert "nomina" not in vis and "comida" in vis


# ── Coherencia de los datos ───────────────────────────────────────────────────

def test_todos_los_grupos_usados_existen_y_no_hay_grupos_sin_uso():
    usados = set()
    for linea in TEXTO.splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#"):
            usados.add(linea.rpartition("=>")[2].strip())
    assert usados <= set(GRUPOS)
    assert set(GRUPOS) - usados == set()


def test_cada_grupo_acaba_en_una_categoria_por_defecto_salvo_seguros():
    por_defecto = {norm_categoria(n) for nombres in DEFAULT_CATEGORIES.values() for n in nombres}
    for nombre, (tipo, candidatas) in GRUPOS.items():
        assert tipo in DEFAULT_CATEGORIES and candidatas, nombre
        if nombre == "seguro":
            continue
        assert any(norm_categoria(c) in por_defecto for c in candidatas), nombre


def test_cobertura_inicial_razonable():
    alias = sum(len(v) for v in _INDICE.values())
    assert alias >= 300
    marcas = sum(len([a for a in linea.split("=>")[0].split("|") if a.strip()])
                 for linea in TEXTO.splitlines() if "=>" in linea)
    assert marcas >= 300


def test_categorias_por_defecto_coinciden_con_el_frontend():
    js = Path(__file__).resolve().parents[2] / "controlGastosMovil" / "src" / "data" / "categories.js"
    if not js.exists():
        pytest.skip("no está el frontend junto al backend")
    texto = js.read_text(encoding="utf-8")
    bloque = texto[texto.index("DEFAULT_CATEGORIES"):texto.index("// Nombre de categoría")]
    for tipo in (V, F):
        seccion = re.search(r"'%s':\s*\[(.*?)\]" % tipo, bloque, re.S).group(1)
        assert tuple(re.findall(r"concepto:\s*'([^']+)'", seccion)) == DEFAULT_CATEGORIES[tipo]


def test_sin_llamadas_de_red(monkeypatch):
    def prohibido(*a, **k):
        raise AssertionError("el diccionario no debe usar la red")
    monkeypatch.setattr(socket.socket, "connect", prohibido)
    monkeypatch.setattr(socket, "getaddrinfo", prohibido)
    assert sug("Mercadona") == (V, "Comida")
