"""Diccionario de comercios y cadenas de España -> categoría sugerida.

Es DATO ESTÁTICO y PÚBLICO (nombres de empresas, nada de datos personales), por
eso vive en el código y no en la base de datos: se versiona con git, se revisa
en cada cambio y no necesita migraciones. Lo usa services/merchant_dict.py.

CÓMO AÑADIR UN COMERCIO
  1. Busca en TEXTO la sección que le toque y añade UNA línea:

         alias uno | alias dos | otro nombre  => grupo

     - Los alias se escriben como los verías en el extracto; da igual el uso de
       mayúsculas, tildes, puntos o símbolos ("McDonald's", "H&M", "Pull&Bear").
     - Se busca por PALABRAS COMPLETAS, no por trozos: "zara" casa con
       "ZARA 0123 MADRID" pero no con "ZARAGOZA". Los números de tienda y
       "S.A."/"S.L." se ignoran solos.
     - Un alias de varias palabras es más específico que uno de una palabra
       ("zara home" gana a "zara"): úsalo para separar casos.
     - Si el nombre puede aparecer dentro de otra frase ("DIA" en "MENU DEL DIA",
       "BP" en cualquier sitio), pon ^ delante: "^dia" solo vale si el nombre
       EMPIEZA por ahí.
     - No hace falta poner dominios (.com, .es): se ignoran.
     - Las palabras GENÉRICAS (farmacia, restaurante, gasolinera...) llevan ~
       delante: "~farmacia". Sirven para acertar la categoría, pero lo que el
       usuario aprende no se comparte entre "Farmacia López" y "Farmacia Gómez"
       (las marcas sí: lo aprendido con "Zara Madrid" vale para "Zara Sevilla").
  2. Elige un grupo de GRUPOS. Cada grupo tiene una lista ORDENADA de
     categorías candidatas: se usa la primera que el usuario tenga visible
     (por defecto, propia y no oculta). Así a quien tenga una categoría propia
     "Supermercado" se le sugiere esa, y al resto "Comida".
  3. Si ningún grupo encaja, añade uno nuevo en GRUPOS (tipo preferido +
     candidatas; pon al final una categoría POR DEFECTO de la app como
     respaldo, salvo que no haya ninguna razonable).
  4. Ejecuta `python -m pytest -q tests/test_merchant_dict.py`: comprueba que
     no hay alias repetidos con distinto grupo ni grupos inexistentes.

Las categorías por defecto reflejan controlGastosMovil/src/data/categories.js
(un test avisa si dejan de coincidir).
"""

GV = "Gasto Variable"
GF = "Gasto Fijo"

# Categorías por defecto de la app (tipo -> nombres). Debe coincidir con categories.js.
DEFAULT_CATEGORIES = {
    GV: ("Ocio", "Comida", "Ropa", "Vuelos", "Gimnasio", "Suscripciones", "Variado"),
    GF: ("Piso", "Luz", "Gas", "Agua", "Wifi", "Transporte", "Inversiones", "Cripto"),
}

# grupo -> (tipo preferido, categorías candidatas por orden de preferencia).
# Las propias del usuario suelen ir antes y la categoría por defecto al final.
GRUPOS = {
    "supermercado": (GV, ("Supermercado", "Supermercados", "Compra", "Compra semanal", "Alimentacion", "Comida")),
    "alimentacion": (GV, ("Alimentacion", "Supermercado", "Supermercados", "Compra", "Comida")),
    "restaurante":  (GV, ("Restaurantes", "Restaurante", "Comer fuera", "Comidas fuera", "Comida")),
    "cafeteria":    (GV, ("Cafeteria", "Cafe", "Cafes", "Restaurantes", "Comida")),
    "delivery":     (GV, ("Comida a domicilio", "Delivery", "Restaurantes", "Comida")),
    "ropa":         (GV, ("Ropa", "Moda", "Vestir")),
    "deporte":      (GV, ("Deporte", "Deportes", "Ocio")),
    "gimnasio":     (GV, ("Gimnasio", "Deporte", "Deportes")),
    "gasolina":     (GF, ("Gasolina", "Combustible", "Coche", "Transporte")),
    "transporte":   (GF, ("Transporte",)),
    "taxi":         (GF, ("Taxi", "Transporte")),
    "parking":      (GF, ("Parking", "Coche", "Transporte")),
    "viaje_tierra": (GV, ("Viajes", "Transporte")),
    "vuelos":       (GV, ("Vuelos", "Viajes", "Ocio")),
    "viajes":       (GV, ("Viajes", "Vacaciones", "Alojamiento", "Ocio")),
    "farmacia":     (GV, ("Farmacia", "Salud", "Sanidad", "Variado")),
    "salud":        (GV, ("Salud", "Sanidad", "Medico", "Variado")),
    "optica":       (GV, ("Optica", "Salud", "Variado")),
    "belleza":      (GV, ("Belleza", "Cuidado personal", "Peluqueria", "Variado")),
    "peluqueria":   (GV, ("Peluqueria", "Belleza", "Cuidado personal", "Variado")),
    "streaming":    (GV, ("Streaming", "Suscripciones")),
    "suscripcion":  (GV, ("Suscripciones", "Suscripcion")),
    "telefonia":    (GF, ("Telefono", "Telefonia", "Movil", "Internet", "Wifi")),
    "luz":          (GF, ("Luz", "Electricidad")),
    "luz_gas":      (GF, ("Luz", "Electricidad", "Gas")),
    "gas":          (GF, ("Gas",)),
    "agua":         (GF, ("Agua",)),
    "seguro":       (GF, ("Seguros", "Seguro")),          # sin categoría por defecto: solo si el usuario la tiene
    "inversion":    (GF, ("Inversiones", "Inversion")),
    "cripto":       (GF, ("Cripto", "Criptomonedas", "Inversiones")),
    "ocio":         (GV, ("Ocio", "Entretenimiento")),
    "cine":         (GV, ("Cine", "Ocio", "Entretenimiento")),
    "videojuegos":  (GV, ("Videojuegos", "Juegos", "Ocio")),
    "libros":       (GV, ("Libros", "Cultura", "Ocio")),
    "hogar":        (GV, ("Hogar", "Casa", "Bricolaje", "Variado")),
    "compras":      (GV, ("Compras", "Variado")),
    "tecnologia":   (GV, ("Tecnologia", "Electronica", "Compras", "Variado")),
    "mascotas":     (GV, ("Mascotas", "Animales", "Variado")),
    "educacion":    (GV, ("Educacion", "Formacion", "Cursos", "Variado")),
    "tabaco":       (GV, ("Tabaco", "Variado")),
}

# Una línea por comercio:  alias | alias | ^alias_solo_al_inicio  => grupo
TEXTO = """
# ── Supermercados y alimentación ──────────────────────────────────────────────
mercadona => supermercado
carrefour | carrefour express | carrefour market => supermercado
alcampo | supeco => supermercado
^dia | supermercados dia | dia market => supermercado
lidl => supermercado
aldi => supermercado
eroski | caprabo => supermercado
consum => supermercado
bon preu | bonpreu | bonarea | esclat => supermercado
condis | ametller origen => supermercado
ahorramas => supermercado
supersol | dialprix | gadis | froiz | hiperdino => supermercado
coviran | alimerka | masymas | mas y mas => supermercado
^spar | family cash | bm supermercados | sorli => supermercado
hipercor | supercor => supermercado
costco | makro | leclerc => supermercado
~supermercado | ~supermercados | ~hipermercado => supermercado
~panaderia | ~carniceria | ~pescaderia | ~fruteria | ~charcuteria | ~ultramarinos => alimentacion
too good to go | toogoodtogo => alimentacion

# ── Restauración, comida rápida, cafeterías y reparto ─────────────────────────
mcdonalds | mcdonald s => restaurante
burger king => restaurante
kfc => restaurante
telepizza => restaurante
dominos | domino s => restaurante
pizza hut | papa johns | papa john s => restaurante
foster s hollywood | fosters hollywood => restaurante
vips | ginos | gino s | goiko | the good burger | tgb => restaurante
five guys | ^subway | taco bell | rodilla => restaurante
100 montaditos | montaditos | la sureña | lizarran | canas y tapas => restaurante
la tagliatella | tagliatella | muerde la pasta | wagamama | wok to walk | honest greens | poke house => restaurante
pans and company | pans company | foodie => restaurante
~restaurante | ~restaurant | ~pizzeria | ~cerveceria | ~taberna | ~asador | ~hamburgueseria | ~marisqueria | ~heladeria => restaurante
~^bar | ~^cafe bar => restaurante
starbucks | costa coffee | tim hortons | dunkin | dunkin donuts | ~cafeteria => cafeteria
glovo | just eat | justeat | uber eats | ubereats | deliveroo => delivery
hellofresh | hello fresh => delivery

# ── Ropa, calzado y moda ──────────────────────────────────────────────────────
zara | zara kids => ropa
bershka | pull and bear | pull bear | stradivarius | massimo dutti | oysho | uterque | lefties => ropa
^h m | ^c a => ropa
mango | primark | kiabi | springfield | cortefiel | women secret | womensecret => ropa
tezenis | calzedonia | intimissimi | tendam => ropa
shein | zalando | about you | asos | vinted => ropa
desigual | scalpers | el ganso | sfera | bimba y lola => ropa
lacoste | tommy hilfiger | calvin klein | levis | levi s | pepe jeans => ropa
^jd sports | foot locker | skechers | nike | adidas | puma | new balance => ropa
pikolinos | camper | clarks | merkal | decimas => ropa
parfois | misako | claires | claire s => ropa
zara home | h m home | hm home => hogar

# ── Gasolineras y coche ───────────────────────────────────────────────────────
repsol | cepsa | moeve | galp | petronor | ballenoil | plenoil | petroprix | tamoil | esclatoil | shell | waylet => gasolina
^bp | ^avia | ^disa | ^q8 => gasolina
~gasolinera | ~estacion de servicio => gasolina
empark | saba parking | indigo parking | bamsa | telpark | ~parking | ~aparcamiento | ~aparcamientos | ~zona azul => parking
via t | ~telepeaje | ~peaje | ~autopista | ~autopistas | abertis => parking

# ── Transporte público, taxi y VTC ────────────────────────────────────────────
renfe | cercanias | rodalies => transporte
metro de madrid | metro madrid | consorcio transportes | crtm | emt madrid => transporte
tmb | metro barcelona | fgc | metrovalencia | metro bilbao | bilbobus | bizkaibus | euskotren | metro sevilla | metro malaga => transporte
tussam | auvasa | ~tranvia | ~autobuses urbanos | ~abono transporte => transporte
bicimad | bicing | valenbisi | emov | movo | reby | muving => transporte
uber | cabify | freenow | free now | mytaxi | ~taxi | ~radio taxi | ~radiotaxi | ^bolt => taxi
alsa | flixbus | blablacar | monbus | ouigo | iryo => viaje_tierra

# ── Vuelos, alojamiento y viajes ──────────────────────────────────────────────
ryanair | vueling | iberia | iberia express | air europa | easyjet | volotea | binter | wizz air | wizzair => vuelos
lufthansa | tap air portugal | klm | air france | norwegian | turkish airlines | emirates | british airways | aer lingus | transavia | ita airways | qatar airways => vuelos
skyscanner | edreams | opodo => vuelos
booking | airbnb | hotels | expedia | trivago | logitravel | rumbo | civitatis | getyourguide => viajes
~hotel | ~hostal | parador | paradores | nh hotels | melia | barcelo hotels | eurostars | iberostar | marriott | hilton => viajes
rentalcars | hertz | avis | europcar | sixt | goldcar | centauro | pepecar => viajes

# ── Farmacia, salud y belleza ─────────────────────────────────────────────────
~farmacia | ~farmacias | ~parafarmacia | promofarma | atida | dosfarma => farmacia
~clinica dental | ~dentista | vitaldent | ~clinica | ~policlinica | ~fisioterapia | quironsalud | hm hospitales | vithas | hospiten => salud
~optica | ~opticas | general optica | generalopticas | multiopticas | alain afflelou | afflelou | cottet => optica
sephora | douglas | primor | perfumerias avenida | druni | maquillalia | marionnaud | the body shop | lush | kiko milano | yves rocher | rituals | notino | ~perfumeria | ~perfumerias => belleza
~peluqueria | ~peluquerias | ~barberia | llongueras | marco aldany | ~centro de estetica => peluqueria

# ── Streaming, suscripciones y servicios digitales ────────────────────────────
netflix | hbo | hbo max | disney plus | disneyplus | prime video | amazon prime | amazon prime video => streaming
movistar plus | filmin | dazn | crunchyroll | twitch | rakuten tv | atresplayer | mitele | skyshowtime | apple tv | paramount plus | youtube premium | youtubepremium | google youtube => streaming
spotify | apple music | tidal | deezer | amazon music | audible | storytel | kindle unlimited => streaming
apple bill | itunes | icloud | google one | google storage | google workspace | dropbox | microsoft 365 | office 365 | adobe | creative cloud | canva | notion | 1password | lastpass | bitwarden => suscripcion
nordvpn | expressvpn | surfshark | protonvpn | protonmail | proton => suscripcion
chatgpt | openai | anthropic | claude ai | perplexity | midjourney | github | figma | duolingo | babbel | patreon => suscripcion
xbox game pass | game pass | playstation plus | ps plus | nintendo switch online => suscripcion

# ── Telefonía, internet, luz, gas y agua ──────────────────────────────────────
movistar | telefonica | vodafone | ^orange | ^digi | yoigo | masmovil | pepephone | lowi | ^o2 | jazztel => telefonia
simyo | finetwork | euskaltel | telecable | adamo | avatel | lebara | tuenti | amena | hits mobile => telefonia
iberdrola | endesa | holaluz | octopus energy | som energia | totalenergies | factorenergia | lucera | energia xxi | viesgo | edp | podo | gesternova | nexus energia | audax | acciona energia => luz
naturgy | gas natural => luz_gas
nedgia | madrilena red de gas | nortegas | redexis | repsol butano | butano => gas
canal de isabel ii | canal isabel ii | aguas de barcelona | agbar | emasesa | aqualia | emivasa | hidraqua | emaya | giahsa => agua

# ── Seguros (solo si el usuario tiene una categoría de seguros) ───────────────
mapfre | axa | allianz | mutua madrilena | linea directa | generali | verti | pelayo | ocaso | catalana occidente | zurich | santalucia | reale | sanitas | adeslas | asisa | dkv | caser | fiatc | helvetia | ~aseguradora => seguro

# ── Inversión y cripto ────────────────────────────────────────────────────────
degiro | trade republic | myinvestor | interactive brokers | xtb | etoro | indexa capital | finizens | scalable capital => inversion
bit2me | coinbase | binance | kraken | bitpanda | bitstamp => cripto

# ── Ocio, cine, videojuegos y cultura ─────────────────────────────────────────
cinesa | yelmo | kinepolis | ocine | cines renoir | mk2 | cinesur | multicines => cine
ticketmaster | ticketea | ~entradas | servientradas | eventbrite | wegow | fever => ocio
portaventura | parque warner | terra mitica | isla magica | aquopolis | zoo aquarium | oceanografic | ~bolera | ~karting | ~escape room | ~paintball => ocio
steam | steam games | steampowered | playstation store | nintendo eshop | epic games | ^game | gamestop | blizzard | riot games | ubisoft | humble bundle | instant gaming | eneba => videojuegos
casa del libro | fnac | agapea | todostuslibros | popular libros | amazon kindle | ~libreria | ~librerias => libros

# ── Gimnasios y deporte ───────────────────────────────────────────────────────
basic fit | basicfit | mcfit | altafit | holmes place | fitness park | vivagym | viva gym | anytime fitness | synergym | metropolitan gym | sportlife | go fit | gofit | clever fitness | wellhub | gympass | ~gimnasio | ~gimnasios => gimnasio
decathlon | intersport | forum sport | sprinter | sport zone | padelnuestro | padel nuestro | padelmarket => deporte

# ── Hogar, bricolaje, compras y tecnología ────────────────────────────────────
leroy merlin | bricomart | bauhaus | brico depot | bricodepot | bricor | ikea | conforama | maisons du monde | kave home | sklum | westwing | jysk | ~ferreteria | ~ferreterias | verdecora | pikolin => hogar
amazon | amzn | amzn mktp | aliexpress | temu | ebay | etsy | wallapop | milanuncios | el corte ingles | corte ingles | pccomponentes | cex | cash converters => compras
apple store | mediamarkt | media markt | worten | coolmod | pcbox | samsung | xiaomi | huawei | gopro | dji | sonos | garmin => tecnologia

# ── Mascotas, educación y otros ───────────────────────────────────────────────
kiwoko | tiendanimal | tienda animal | zooplus | ~veterinario | ~veterinaria | ~clinica veterinaria => mascotas
udemy | coursera | edx | domestika | masterclass | platzi | skillshare | ~autoescuela | ~escuela de idiomas | wall street english | british council => educacion
~estanco | ~estancos | ~expendeduria | tabacalera | ~tabaqueria => tabaco
"""
