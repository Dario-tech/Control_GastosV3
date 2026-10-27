import { useEffect } from 'react'

// Mantiene <meta name="theme-color"> igual que la franja de la isla (--island-bg) o, si no, el fondo (--bg) del tema activo.
// El tema vive como clase en <html> (light, pastel, ocean...; "auto" la cambia
// sola según el sistema), así que se observa esa clase en vez de depender de
// quien la cambie.
export function syncThemeColor(doc = document) {
  const meta = doc.querySelector('meta[name="theme-color"]')
  if (!meta) return
  // --island-bg: color de la franja de la isla (oscuro en los temas claros);
  // si no existe, el fondo del tema.
  const cs = getComputedStyle(doc.documentElement)
  const color = cs.getPropertyValue('--island-bg').trim() || cs.getPropertyValue('--bg').trim()
  if (color) meta.setAttribute('content', color)
}

export function useThemeColorMeta() {
  useEffect(() => {
    syncThemeColor()
    if (typeof MutationObserver === 'undefined') return
    const obs = new MutationObserver(() => syncThemeColor())
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
}
