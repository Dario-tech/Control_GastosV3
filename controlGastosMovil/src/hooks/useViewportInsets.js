import { useEffect } from 'react'

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
    let open = false
    function update() {
      const kb = computeKeyboardHeight(window.innerHeight, vv)
      root.style.setProperty('--kb-h', kb + 'px')
      root.classList.toggle('kb-open', kb > 0)
      // al cerrarse el teclado iOS puede dejar la página desplazada
      if (open && kb === 0) window.scrollTo(0, 0)
      open = kb > 0
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--kb-h')
      root.classList.remove('kb-open')
    }
  }, [])
}
