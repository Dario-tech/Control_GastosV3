import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderHook } from '@testing-library/react'
import { syncThemeColor, useThemeColorMeta } from '../src/hooks/useThemeColorMeta'
import { computeKeyboardHeight } from '../src/hooks/useViewportInsets'

const root = join(__dirname, '..')
const read = f => readFileSync(join(root, f), 'utf8')
const css = read('src/App.css')
const cssSinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('viewport e index.html', () => {
  it('usa viewport-fit=cover y mantiene el zoom desactivado documentado', () => {
    const html = read('index.html')
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/)
    expect(html).toContain('user-scalable=no')
    expect(html).toContain('apple-mobile-web-app-status-bar-style')
    expect(html).toContain('name="theme-color"')
  })
})

describe('variables de zona segura', () => {
  it('se definen una vez en :root con env()', () => {
    const rootBlock = cssSinComentarios.match(/:root\s*\{[\s\S]*?\n\}/)[0]
    for (const lado of ['top', 'bottom', 'left', 'right']) {
      expect(rootBlock).toContain(`--safe-${lado}:`)
      expect(rootBlock).toContain(`env(safe-area-inset-${lado}`)
    }
  })
  it('env(safe-area-inset-*) solo aparece en esas cuatro definiciones', () => {
    expect(cssSinComentarios.match(/env\(safe-area-inset/g)).toHaveLength(4)
  })
  it('la cabecera y la barra inferior usan las variables', () => {
    const header = css.slice(css.indexOf('ZONAS SEGURAS (agente A)'))
    expect(header).toMatch(/\.header\s*\{[^}]*height:\s*var\(--header-h\)[^}]*padding:\s*var\(--safe-top\)/)
    expect(header).toMatch(/\.bottom-nav\s*\{[^}]*bottom:\s*calc\(10px \+ var\(--safe-bottom\)\)/)
    expect(css).toMatch(/--header-h:\s*calc\(var\(--header-base\) \+ var\(--safe-top\)\)/)
    expect(css).toMatch(/--nav-h:\s*calc\(76px \+ var\(--safe-bottom\)\)/)
  })
  it('el perfil cubre toda la pantalla (no se recorta por la barra inferior)', () => {
    expect(cssSinComentarios).not.toMatch(/height:\s*calc\(100dvh - var\(--nav-h\)\)/)
    expect(css).toMatch(/\.profile-screen\s*\{\s*top: 0; bottom: 0;/)
  })
  it('html y body pintan el fondo del tema', () => {
    expect(css).toMatch(/html\s*\{\s*background-color:\s*var\(--bg\)/)
    expect(css).toMatch(/body\s*\{\s*background-color:\s*var\(--bg\)/)
  })
  it('el shell usa 100dvh con fallback 100vh', () => {
    expect(css).toMatch(/height:\s*100vh;\s*height:\s*100dvh;\s*max-width:\s*var\(--shell-max\)/)
  })
})

describe('theme-color dinámico', () => {
  afterEach(() => {
    document.head.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove())
    document.documentElement.removeAttribute('style')
    document.documentElement.className = ''
  })
  const meta = () => document.querySelector('meta[name="theme-color"]')

  it('copia --bg del tema activo y reacciona al cambio de clase en <html>', async () => {
    const m = document.createElement('meta')
    m.name = 'theme-color'; m.content = '#000000'
    document.head.appendChild(m)
    document.documentElement.style.setProperty('--bg', '#111111')
    const { unmount } = renderHook(() => useThemeColorMeta())
    expect(meta().content).toBe('#111111')
    document.documentElement.style.setProperty('--bg', '#fff0f7')
    document.documentElement.classList.add('pastel')
    await new Promise(r => setTimeout(r, 0))
    expect(meta().content).toBe('#fff0f7')
    unmount()
  })
  it('no falla sin la etiqueta meta', () => {
    expect(() => syncThemeColor()).not.toThrow()
  })
})

describe('teclado virtual', () => {
  it('calcula la altura del teclado con visualViewport', () => {
    expect(computeKeyboardHeight(800, { height: 500, offsetTop: 0 })).toBe(300)
    expect(computeKeyboardHeight(800, { height: 740, offsetTop: 0 })).toBe(0) // barra del navegador
    expect(computeKeyboardHeight(800, { height: 500, offsetTop: 100 })).toBe(200)
    expect(computeKeyboardHeight(800, null)).toBe(0)
  })
})

describe('ronda 2: pantallas completas, isla, campana y ejes', () => {
  const ronda2 = css.slice(css.lastIndexOf('ZONAS SEGURAS, ronda 2'))
  it('el perfil no usa left:50% ni translate(-50%) y no tiene tope de ancho', () => {
    const bloque = css.match(/\.profile-screen \{\s*position: fixed;[\s\S]*?\n\}/)[0]
    expect(bloque).toMatch(/left: 0; right: 0/)
    expect(bloque).not.toMatch(/left:\s*50%/)
    expect(css).toMatch(/\.profile-screen\.open \{ transform: translateX\(0\); \}/)
    expect(ronda2).toMatch(/\.profile-screen \{ left: 0; right: 0; width: 100%; max-width: none; \}/)
  })
  it('ningún contenedor del shell queda fijado a 430px y no hay bordes de 1px bajo 481px', () => {
    expect(cssSinComentarios).not.toMatch(/max-width:\s*430px/)
    expect(cssSinComentarios).toMatch(/@media \(min-width: 481px\) \{\s*\.app \{/)
  })
  it('fm-body sin pie reserva la barra de inicio', () => {
    expect(ronda2).toMatch(/\.fm-body:last-child \{ padding-bottom: calc\(24px \+ var\(--safe-bottom\)\)/)
  })
  it('--island-bg es el color base del fondo por tema, sin franja sólida, y theme-color lo usa', () => {
    expect(ronda2).toMatch(/html\.light\s+\{ --island-bg: #eef2fb/)
    expect(ronda2).toMatch(/html\.pastel\s+\{ --island-bg: #fff0f7/)
    expect(ronda2).not.toMatch(/var\(--island-bg\) var\(--safe-top\)/)
    expect(read('src/hooks/useThemeColorMeta.js')).toContain('--island-bg')
  })
  it('la campana es circular de 36px con insignia y para el pulso con reducir movimiento', () => {
    expect(css).toMatch(/\.pending-btn \{[^}]*width: 36px; height: 36px;[^}]*border-radius: 50%/)
    expect(css).toMatch(/\.pending-badge \{[^}]*position: absolute/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.pending-btn \{ animation: none; \} \}/)
    expect(read('src/components/layout/Header.jsx')).toContain('aria-label={`Categorizar pagos pendientes')
  })
  it('los ejes de los gráficos leen --chart-tick, con contraste >= 4,5:1 por tema', () => {
    const lum = hex => {
      const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
    expect(ronda2).toContain('fill: var(--chart-tick)')
    expect(ratio('#d3d9ec', '#000000')).toBeGreaterThan(4.5)
    expect(ratio('#2c2c48', '#F2F2F7')).toBeGreaterThan(4.5)
    expect(ratio('#7c0f44', '#fff0f7')).toBeGreaterThan(4.5)
  })
})

describe('ronda 3: integración arriba/abajo', () => {
  const r3 = css.slice(css.lastIndexOf('INTEGRACIÓN ARRIBA/ABAJO (agente A, ronda 3)'))
  it('el fondo NO desborda el viewport (si no, iOS deja desplazar el documento) y el velo inferior no es opaco', () => {
    expect(r3).toMatch(/html::before \{ content: none; \}/)
    expect(r3).toMatch(/body::before \{ top: 0; right: 0; bottom: 0; left: 0;/)
    // ninguna capa fixed de html/body con desplazamientos negativos
    expect(css).not.toMatch(/(html|body)::before \{[^}]*(top|bottom|left|right): -\d/)
    expect(css).not.toMatch(/(html|body)::before \{[^}]*inset: -/)
    expect(css).not.toMatch(/@media \(display-mode: standalone\) \{[^}]*height: 100lvh/)
    const velo = css.match(/\.app::after \{[^}]*\}/)[0]
    expect(velo).toMatch(/transparent\)\)/)
    expect(velo).not.toMatch(/,\s*var\(--bg\)\)/)
  })
  it('la cabecera es transparente, sin píldora ni sombra, con blur enmascarado', () => {
    expect(r3).toMatch(/\.header \{\s*background: transparent;\s*border: 0; border-radius: 0; box-shadow: none;/)
    expect(r3).toMatch(/\.header::before \{[\s\S]*?mask-image: linear-gradient\(to bottom, #000 0, #000 85%, transparent 100%\)/)
  })
  it('scrim en degradado bajo la isla en todos los temas, también en claro y pastel', () => {
    expect(r3).toMatch(/body::after \{[\s\S]*?height: calc\(var\(--safe-top\) \+ 16px\)[\s\S]*?transparent 100%/)
    expect(r3).toMatch(/html\.light body::after, html\.pastel body::after/)
  })
})

describe('?diag=1', () => {
  it('main.jsx monta la pantalla de diagnóstico solo con diag=1', () => {
    const m = read('src/main.jsx')
    expect(m).toContain("get('diag') === '1'")
    expect(m).toContain('DiagScreen')
  })
})

describe('ronda 3: legibilidad (cabecera y scrim)', () => {
  const r3 = css.slice(css.lastIndexOf('INTEGRACIÓN ARRIBA/ABAJO (agente A, ronda 3)'))
  it('el scrim de claro y pastel mantiene 0,66 hasta 0,62 al 60 % y se funde', () => {
    expect(r3).toContain('rgba(24,24,56,0.66) 0, rgba(24,24,56,0.62) 60%, transparent 100%')
    expect(r3).toContain('rgba(77,21,53,0.66) 0, rgba(77,21,53,0.62) 60%, transparent 100%')
  })
  it('el tinte de la cabecera sube a 85 % hacia abajo', () => {
    expect(r3).toMatch(/var\(--bg\) 62%, transparent\) 0, color-mix\(in srgb, var\(--bg\) 85%, transparent\) 85%/)
  })
  it('los botones de la hoja de categorizar tienen zona táctil de 44px', () => {
    expect(r3).toMatch(/\.catmodal-back::after, \.catmodal-cancel::after \{[^}]*height: 44px/)
  })
})
