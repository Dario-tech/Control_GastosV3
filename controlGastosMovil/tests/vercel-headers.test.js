import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = rel => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'))
const root = read('../../vercel.json')
const app  = read('../vercel.json')
const hdr = (cfg, source) => Object.fromEntries(cfg.headers.find(h => h.source === source).headers.map(h => [h.key, h.value]))

describe('vercel.json (raíz y controlGastosMovil)', () => {
  it('son JSON válido y llevan los mismos headers y rewrites', () => {
    expect(root.headers).toEqual(app.headers)
    expect(root.rewrites).toEqual(app.rewrites)
  })

  it('la raíz conserva build y salida', () => {
    expect(root.buildCommand).toMatch(/npm run build/)
    expect(root.outputDirectory).toBe('controlGastosMovil/dist')
  })

  it('el rewrite SPA sigue y no captura /assets ni sw.js', () => {
    for (const cfg of [root, app]) {
      expect(cfg.rewrites).toHaveLength(1)
      const [r] = cfg.rewrites
      expect(r.destination).toBe('/index.html')
      const re = new RegExp('^' + r.source + '$')
      expect(re.test('/movimientos/2026')).toBe(true)
      expect(re.test('/')).toBe(true)
      expect(re.test('/assets/index-abc.js')).toBe(false)
      expect(re.test('/sw.js')).toBe(false)
    }
  })

  it('cabeceras de seguridad en todas las rutas', () => {
    const h = hdr(root, '/(.*)')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['X-Frame-Options']).toBe('DENY')
    for (const f of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(h['Permissions-Policy']).toContain(`${f}=()`)
    }
  })

  it('la CSP va en modo solo informe y permite Google Identity y la API', () => {
    const h = hdr(root, '/(.*)')
    expect(h['Content-Security-Policy']).toBeUndefined()
    const csp = h['Content-Security-Policy-Report-Only']
    expect(csp).toContain("default-src 'self'")
    expect(csp).toMatch(/script-src [^;]*https:\/\/accounts\.google\.com/)
    expect(csp).toMatch(/frame-src [^;]*https:\/\/accounts\.google\.com/)
    expect(csp).toMatch(/connect-src [^;]*https:\/\/\*\.onrender\.com/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('caché: sin caché para index.html y sw.js, inmutable para /assets', () => {
    expect(hdr(root, '/index.html')['Cache-Control']).toBe('no-cache')
    expect(hdr(root, '/sw.js')['Cache-Control']).toBe('no-cache')
    expect(hdr(root, '/assets/(.*)')['Cache-Control']).toBe('public, max-age=31536000, immutable')
  })
})
