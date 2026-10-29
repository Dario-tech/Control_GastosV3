import { useEffect } from 'react'
import { safeTopFloor } from '../utils/safeAreaFloor'

// Teclado virtual: en iOS el teclado no reduce el viewport de maquetación, así
// que los formularios con pie fijo quedaban tapados. Se mide con visualViewport,
// se publica como --kb-h en <html> (los fm-screen/hojas usan bottom: var(--kb-h))
// y se marca html.kb-open para quitar el relleno de la barra de inicio.
export function computeKeyboardHeight(innerHeight, vv) {
  if (!vv) return 0
  const kb = Math.round(innerHeight - vv.height - vv.offsetTop)
  return kb > 120 ? kb : 0 // <120 px: barra del navegador, no teclado
}

export function useViewportInsets() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    // Mínimo de zona segura superior cuando iOS declara 0 (ver utils/safeAreaFloor.js)
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px)'
    document.body.appendChild(probe)
    const declared = parseFloat(getComputedStyle(probe).paddingTop) || 0
    probe.remove()
    const floor = safeTopFloor({
      declared, screenW: window.screen.width, screenH: window.screen.height,
      ua: window.navigator.userAgent, touch: (window.navigator.maxTouchPoints || 0) > 0,
    })
    if (floor) root.style.setProperty('--safe-top-floor', floor + 'px')
    let open = false
    function update() {
      const kb = computeKeyboardHeight(window.innerHeight, vv)
      root.style.setProperty('--kb-h', kb + 'px')
      root.classList.toggle('kb-open', kb > 0)
      // al cerrarse el teclado iOS puede dejar la página desplazada
      if (open && kb === 0) window.scrollTo(0, 0)
      open = kb > 0
    }
    // El documento no debe desplazarse nunca (todo el scroll es interno de .main y las hojas):
    // si iOS lo mueve, la app sube, la cabecera queda bajo la isla y abajo asoma el vacío.
    const anclar = () => { if (!open && (window.scrollY || window.scrollX)) window.scrollTo(0, 0) }
    update()
    window.addEventListener('scroll', anclar, { passive: true })
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('scroll', anclar)
      root.style.removeProperty('--kb-h')
      root.style.removeProperty('--safe-top-floor')
      root.classList.remove('kb-open')
    }
  }, [])
}
