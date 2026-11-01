# Hueco abajo y franja difuminada arriba en iPhone (iOS 26)

Resuelto en lo esencial el 01/11/2026. Estado: variante B en `qa` (`04b1f58`) + cabecera 18 px más baja (`e21471f`). `test` quedó con la variante A (`6957673`). `main` (producción) no se tocó.

## Síntomas (lo que veía el usuario)
- **Hueco abajo:** franja en blanco/negro/gris bajo la barra inferior; la app parecía «echada hacia arriba». En la PWA instalada y también en Safari.
- **Arriba:** título «Mi Economía» y botones difuminados o bajo la isla.
- **Formularios a pantalla completa** («Nuevo gasto fijo», «Nueva meta») transparentes, con la pantalla de atrás visible y cabecera/barra por encima (el botón «Crear meta» quedaba oculto).

Primera queja registrada: 25/10/2026 (arriba difuminado, antes de cualquier cambio de iPhone). Hueco abajo descrito por primera vez el 28/10 22:55.

## Medidas reales (iPhone 17 Pro, 402×874, PWA instalada)
innerHeight **812** con screen.height **874** (faltan 62 px = safe-top), `100vh`/`100lvh` = 874, `100dvh`/`100svh`/`100%` = 812, safe-top 62, safe-bottom 34. En Safari normal (no instalada) y sin App montada ya salía 660 con las barras del navegador. Pantalla de diagnóstico: `/?diag=1`, o tocar la línea «build» al final de Perfil.

## Causa
- El hueco **apareció el 27/10 con `d11e00a`**, que añadió `viewport-fit=cover`. La versión del 26/10 (`e1cbdd9`) no lo tenía; se comprobó abriendo los despliegues antiguos de Vercel (cada commit conserva su URL, p. ej. `control-k5vvk7bmi-marito.vercel.app` = antes, `control-93mek9qvm-marito.vercel.app` = con el hueco).
- Error conocido de iOS 26 (WebKit 301108): con `viewport-fit=cover` y barra de estado traslúcida, el viewport de la app instalada mide menos que la pantalla (descuenta la altura de la barra de estado); `100%`, `dvh` e `innerHeight` heredan el error, solo `100vh`/`100lvh` miden la pantalla real. Foro de Apple: dvh dejó huecos tras una actualización de iOS.
- Quitar `viewport-fit=cover` también lo arregla, pero deja una franja negra arriba (iOS reserva la zona de la isla).
- iOS 26 difumina por su cuenta ~80 pt desde arriba (hora/isla); `theme-color` ya no se respeta (el color sale del fondo de html/body). No hay CSS ni meta que lo desactive; solo se evita no poniendo contenido ahí.
- Los formularios transparentes eran por una `mask-image` sobre `.main` (corte limpio bajo la cabecera): enmascara también a los hijos `position:fixed`.

## Qué NO funcionó (no repetir)
- Estirar la app con JS midiendo `screen.height - innerHeight` (`--vp-gap`, `bottom` negativo, `height: var(--screen-h)`): iOS no pinta fuera de lo que declara.
- Ajustar a ojo la cabecera restando píxeles a la zona segura (8, 14, 22, 53 px) y subir la cabecera: la dejaba bajo la isla/franja difuminada.
- Tabla de márgenes por modelo de iPhone (`safeAreaFloor.js`, otra sesión): es lo contrario de responsive; se eliminó. **Regla del usuario: el diseño debe ser responsive y usar solo `env(safe-area-inset-*)`, nada por modelo ni por navegador.**
- Reinstalar la PWA, imágenes de arranque por tamaño, `display-mode: standalone` con `100vh`/`100lvh` solo en `#root, .app` (dejando `html`/`body` en 100 %).
- Mis capturas con Playwright/CDP no reproducen el fallo: la simulación siempre da la altura correcta; no hay simulador de iOS instalado (falta el runtime en Xcode).

## Qué funcionó
- Variante **A**: `viewport-fit=cover` + `@media (display-mode: standalone){ html, body, #root, .app { height: 100lvh } }`.
- Variante **B** (la que quedó en `qa`): `viewport-fit=cover` + `html, body, #root, .app { height: 100vh; min-height: 100vh }` y `.login-screen { min-height: 100vh }`, sin media query.
- Ambas se probaron en Safari (login) sin hueco; ramas de prueba `prueba-cover-a` / `prueba-cover-b`. Falta confirmar en la PWA instalada y en Android (no hay informes de este fallo en Android).
- Cabecera y barra del perfil bajo la zona segura completa (`--safe-top-use: var(--safe-top)`) más 18 px solo si hay zona segura (`calc(var(--safe-top) + min(var(--safe-top), 1px) * 18)`).
- Formularios: se quitó la máscara de `.main`; ahora `.main` va entre cabecera y barra con `position:absolute; top: var(--header-h); bottom: calc(var(--nav-gap) + 66px)` y los paddings de `.tab-panel` pasan a 12/28 px.
- Si el título sigue borroso: bloque fijo del color del tema en la franja de la isla (solución descrita por otros desarrolladores).

## Otras decisiones de la sesión
- Se quita todo sombreado/difuminado de la cabecera y del velo inferior; la barra inferior queda fija abajo sin velo.
- `?diag=1` y el atajo en Perfil se conservan para medir; la línea verde de diagnóstico marca la altura real de la pantalla.

## Cómo diagnosticar si reaparece
1. Abrir `/?diag=1` en la PWA instalada y comparar `innerHeight` con `screen.height`.
2. Comparar con los despliegues antiguos de Vercel (cada commit tiene URL propia; `list_deployments` del proyecto `control`).
3. Comprobar primero `viewport-fit=cover` y la cadena de alturas `html > body > #root > .app`.

## Fuentes
- Resumen de WebKit 301108 y fix `100lvh` en standalone: https://github.com/ggghhhjjj/csd-bg/pull/12 · https://github.com/ethan8damax/Coffee-SNOB/pull/7
- Foro de Apple (dvh y huecos): https://developer.apple.com/forums/thread/803987
- Safari 26 ignora `theme-color`: https://discussions.apple.com/thread/256138682 · https://bugs.webkit.org/show_bug.cgi?id=301756
- Bloque fijo para el color de la barra: https://zenn.dev/timelab/articles/b471d6beed9f6e · https://benfrain.com/ios26-safari-theme-color-tab-tinting-with-fixed-position-elements/
