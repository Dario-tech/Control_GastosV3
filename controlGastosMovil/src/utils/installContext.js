// Dónde se está abriendo la app: navegador o app instalada (PWA), y en qué sistema/navegador.
// Solo sirve para mostrar las instrucciones de instalación correctas; el diseño NO depende de esto.
export function detectInstallContext({ ua = '', standalone = false, maxTouchPoints = 0 } = {}) {
  const isIpadOs = /Macintosh/.test(ua) && maxTouchPoints > 1
  const platform = /iPhone|iPad|iPod/.test(ua) || isIpadOs ? 'ios' : /Android/.test(ua) ? 'android' : 'other'
  let browser = 'other'
  if (platform === 'ios') {
    browser = /CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : 'safari'
  } else if (/SamsungBrowser/.test(ua)) browser = 'samsung'
  else if (/Firefox/.test(ua)) browser = 'firefox'
  else if (/EdgA|Edg\//.test(ua)) browser = 'edge'
  else if (/Chrome\//.test(ua)) browser = 'chrome'
  return { platform, browser, installed: !!standalone }
}

export function currentInstallContext(win = window) {
  const standalone = win.navigator.standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches
  return detectInstallContext({ ua: win.navigator.userAgent || '', standalone, maxTouchPoints: win.navigator.maxTouchPoints || 0 })
}

export function installSteps({ platform, browser }) {
  if (platform === 'ios') {
    return browser === 'safari'
      ? ['Pulsa el botón Compartir (el cuadrado con una flecha hacia arriba).', 'Elige «Añadir a pantalla de inicio».', 'Pulsa «Añadir». Ábrela desde el icono nuevo.']
      : ['Pulsa Compartir y elige «Añadir a pantalla de inicio».', 'Si no te sale esa opción, abre esta misma dirección en Safari y repítelo allí.', 'Ábrela desde el icono nuevo.']
  }
  if (platform === 'android') {
    return browser === 'firefox'
      ? ['Abre el menú ⋮ del navegador.', 'Elige «Instalar».', 'Ábrela desde el icono nuevo.']
      : ['Abre el menú ⋮ del navegador.', 'Elige «Instalar app» (o «Añadir a pantalla de inicio»).', 'Ábrela desde el icono nuevo.']
  }
  return ['Busca en el navegador la opción «Instalar» (suele estar junto a la barra de direcciones o en el menú).']
}
