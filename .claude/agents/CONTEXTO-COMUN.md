# Contexto común de los agentes de «Mi Economía»

Léelo ENTERO antes de empezar. Es lo que sabe el equipo del proyecto.

## Qué es
App personal/familiar de control de gastos con **2 usuarios reales** (PWA móvil, solo iPhone/estrecho, 430 px). Frontend React 18 + Vite en `controlGastosMovil/`, backend FastAPI + Postgres en `backend/`. El usuario NO es técnico: explícale todo en español sencillo, sin jerga.

## Entornos y flujo
- **Producción** (rama `main`): NO se toca. Código de julio; recibirá todo cuando el usuario diga «a main».
- **QA** (rama `qa`: Vercel `control` + Render `Control_GastosV3` + Supabase `QA_GASTOS`) y **test** (rama `test`: misma app en `control-git-test-marito.vercel.app`, backend Render `control-gastos-api-test`, BD Render Postgres con copia de producción). Flujo: rama de trabajo → `qa` → `test` → `main`.
- Cada push a `qa`/`test` reinicia su backend en Render (plan gratuito: tarda ~30 s en despertar).

## Reglas innegociables
1. **Producción: nada, ni lectura.** QA/test desplegados: no pruebas activas ni escritura; solo el propio usuario con su sesión.
2. **Nunca uses, pidas ni imprimas secretos** (contraseñas, claves, tokens, `.env`). Datos de prueba solo del entorno LOCAL (usuario `qa@mieconomia.test`, contraseña local que te indique quien te lance).
3. **Solo lectura sobre el repositorio**: no edites ficheros existentes, no `git add/commit/push`. Tus ficheros temporales van en el scratchpad que se te indique. Si tu tarea pide un informe en un fichero, solo el que se te nombre.
4. Las pruebas activas (ataques, carga, fuzzing) **solo contra el stack local aislado** (puertos 81xx/51xx) y lo limpias al terminar (`docker compose -p <proyecto> down -v`).
5. No des consejos de inversión ni financieros personalizados.

## Cómo observar la app de verdad
- Stack local con Docker: copia el repo (sin `.git`, `node_modules`, `dist`) al scratchpad, copia `docker-compose.local.yml` con rutas absolutas y puertos propios, `seed_qa.py` (`QA_PASSWORD` local), datos ficticios con `enrich.py` si existe en el scratchpad del equipo (`scratchpad/docs/enrich.py`).
- Navegador: **Playwright con el Chrome del sistema** (`playwright-core` instalado solo en el scratchpad; hay un ejemplo en `scratchpad/docs/pw`). No uses el panel `Claude_Browser` si hay otros agentes en paralelo (es único y se pisan).
- Móvil 390×844 y 360×800, factor 2, los 3 temas (oscuro, claro, pastel; clases `html.light` / `html.pastel`). Mira consola y red. Una captura describe más que mil líneas: guarda las que cites en tu carpeta de scratchpad y nómbralas en el informe.

## Qué ya está hecho (no lo repitas como hallazgo)
Fecha local Hoy/Ayer; sin Inversiones/precios/yfinance; bcrypt en hilo aparte; límites de emoji IA y atajo; accesibilidad rápida (aria, zonas táctiles 44 px, `aria-current`); idempotencia de gastos (`id_cliente`) y cola sin conexión; doble escritura en claro apagable (`LEGACY_PLAIN_WRITE=0`, activa en test); Atajo de Apple Pay en 2 modos (abrir la app / en segundo plano, con prompts); clave del Atajo fuera del login y del navegador; crear categorías desde Ajustes; importe de pendientes cifrado; red de seguridad de errores (ErrorBoundary) y recarga única ante fichero antiguo; búsqueda accesible (🔍); moneda €/$/£; exportar JSON/CSV; ocultar categorías por defecto; ocultar importes completo; estadísticas con categorías reales; CI en GitHub (build + tests).

## Pendientes conocidos (mencionables, pero ya anotados)
Rotación de la clave del Atajo (permanente y en claro en BD); copias de seguridad automáticas y custodia de `DB_ENCRYPTION_KEY`; keep-alive fiable de producción; búsqueda sin ignorar acentos; hoja de categorizar sin Escape; paleta de 10 colores se repite; datos en claro restantes (nombres de metas y gastos fijos, comentarios); zoom del viewport desactivado a propósito (compromiso de accesibilidad); BD gratuita de test caduca el 22/11/2026.

## Formato del informe (obligatorio)
1. **Resumen en 5 líneas** para una persona no técnica.
2. **Hallazgos** en tabla: `#`, mejora/fallo, por qué importa (sin jerga), evidencia (pantalla + captura, o fichero:línea), impacto (alto/medio/bajo), esfuerzo (bajo/medio/alto), riesgo de arreglarlo, **[COMPROBADO]** (lo viste) o **[SUPUESTO]**.
3. **Top 5** con orden sugerido y quién lo haría (`frontal`, `backend`, `infra`, `tester`).
4. **¿Hace falta mejorar la infraestructura?** Una sección propia: sí/no y qué (costes, planes gratuitos, observabilidad, copias de seguridad, despliegue), siempre con aviso de coste antes de proponer algo de pago.
5. Lo que NO pudiste comprobar y por qué.
Sé concreto y honesto: distingue lo comprobado de lo supuesto, y no inventes líneas ni medidas.
