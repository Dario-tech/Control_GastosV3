import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { AuthProvider } from '../src/context/AuthContext'
import { SettingsProvider, useSettings } from '../src/context/SettingsContext'
import { AUTH_KEY, CUSTOM_CATS_KEY, BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1, SETTINGS_KEY, TOUR_KEY } from '../src/utils/storageKeys'

// Caso real modelado con datos ficticios: un usuario con ~10 categorías propias
// y presupuestos v1/v2/v3 mezclados hace su primer login tras el despliegue.
// Servidor falso con VARIOS usuarios (se identifica por el token Bearer).

function makeMultiUserServer() {
  const users = {}   // token -> { cats, prefs, nextId }
  const s = { users, log: [], onRequest: null }
  const of = (token) => (users[token] ??= { cats: [], prefs: { settings: null, budgets: null, hidden_categories: null, tour: null }, nextId: 1 })
  s.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    const method = opts.method || 'GET'
    const token = (opts.headers?.Authorization || '').replace('Bearer ', '')
    const res = (status, body = {}) => ({ status, ok: status < 400, json: async () => body })
    s.log.push(`${method} ${path}`)
    s.onRequest?.(method, path)   // permite mirar localStorage en el instante de cada petición
    if (!token) return res(401)
    const u = of(token)
    const body = opts.body ? JSON.parse(opts.body) : null
    if (path === '/api/prefs' && method === 'GET') return res(200, { ...u.prefs, updated_at: {} })
    const m = path.match(/^\/api\/prefs\/(\w+)$/)
    if (m && method === 'PUT') { u.prefs[m[1]] = body.data; return res(200, { updated_at: 'now' }) }
    if (path === '/api/categories' && method === 'GET') return res(200, { categories: u.cats })
    if (path === '/api/categories/import') {
      let imported = 0, skipped = 0
      for (const it of body.items) {
        if (u.cats.some(c => c.tipo === it.tipo && c.concepto === it.concepto)) skipped++
        else { u.cats.push({ id: `${token}-${u.nextId++}`, emoji: '', ...it }); imported++ }
      }
      return res(200, { imported, skipped, categories: u.cats })
    }
    return res(404)
  })
  return s
}

const wrapper = ({ children }) => <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
const login = (email, name, sessionToken) =>
  localStorage.setItem(AUTH_KEY, JSON.stringify({ email, name, sessionToken }))
const ALL_LEGACY = [CUSTOM_CATS_KEY, BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1, SETTINGS_KEY, TOUR_KEY]

const TEN = ['Clínica', 'Mascotas', 'Seguro coche', 'Guardería', 'Gimnasio', 'Libros', 'Regalos', 'Viajes', 'Farmacia', 'Cursos']
function seedRealisticDevice() {
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify({
    'Gasto Variable': TEN.slice(0, 6).map(c => ({ concepto: c, emoji: '🙂' })),
    'Gasto Fijo': TEN.slice(6, 9).map(c => ({ concepto: c, emoji: '📌' })),
    'Ingreso': [{ concepto: TEN[9], emoji: '💶' }],
  }))
  localStorage.setItem(BUDGET_KEY, JSON.stringify([{ id: 'v3', name: 'Ocio v3', limit: 50, month: 2, color: '#6366f1' }]))
  localStorage.setItem(BUDGET_KEY_V2, JSON.stringify([{ id: 'v2', name: 'Ocio v2', limit: 40, color: '#f43f5e' }]))
  localStorage.setItem(BUDGET_KEY_V1, JSON.stringify([{ id: 'v1', name: 'Ocio v1', limit: 30 }]))
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'pastel', accent: '#10b981' }))
  localStorage.setItem(TOUR_KEY, '2026-01-01T00:00:00.000Z')
}

describe('primer login tras el despliegue (usuario con datos antiguos) + otros dispositivos', () => {
  let server
  beforeEach(() => { localStorage.clear(); server = makeMultiUserServer(); vi.stubGlobal('fetch', server.fetch) })
  afterEach(() => vi.unstubAllGlobals())

  it('sube las 10 categorías y los presupuestos, no borra nada antes de confirmar; 2.º dispositivo las ve y un 3.er usuario no', async () => {
    // ── Dispositivo 1: primer login con todo en localStorage ──
    seedRealisticDevice()
    login('u@u.es', 'Usuaria', 'tok-u')
    // Cada petición se hace con las claves antiguas AÚN presentes en el dispositivo
    // (el borrado ocurre después de la respuesta, nunca antes de enviar).
    const keysAtRequest = []
    server.onRequest = (method, path) => {
      if (method !== 'GET') keysAtRequest.push({ path, left: ALL_LEGACY.filter(k => localStorage.getItem(k) !== null).length })
    }
    const d1 = renderHook(() => useSettings(), { wrapper })
    await waitFor(() => expect(d1.result.current.prefsLoaded).toBe(true))

    const srv = server.users['tok-u']
    expect(srv.cats.map(c => c.concepto).sort()).toEqual([...TEN].sort())
    expect(new Set(srv.cats.map(c => `${c.tipo}|${c.concepto}`)).size).toBe(10)
    // presupuestos: gana la cadena más nueva (v3); v2/v1 no se mezclan
    expect(srv.prefs.budgets.items.map(i => i.id)).toEqual(['v3'])
    expect(srv.prefs.settings).toEqual({ theme: 'pastel', accent: '#10b981' })
    expect(srv.prefs.tour.seen_at).toBe('2026-01-01T00:00:00.000Z')
    // el primer envío (importar categorías) ocurrió con las 6 claves aún presentes
    expect(keysAtRequest[0]).toEqual({ path: '/api/categories/import', left: 6 })
    // y solo tras confirmar se borran todas
    for (const k of ALL_LEGACY) expect(localStorage.getItem(k), k).toBeNull()
    expect(Object.values(d1.result.current.customCategories).flat()).toHaveLength(10)
    d1.unmount()

    // ── Dispositivo 2 del mismo usuario (localStorage vacío) ──
    localStorage.clear()
    login('u@u.es', 'Usuaria', 'tok-u')
    server.log.length = 0
    const d2 = renderHook(() => useSettings(), { wrapper })
    await waitFor(() => expect(d2.result.current.prefsLoaded).toBe(true))
    expect(Object.values(d2.result.current.customCategories).flat().map(c => c.concepto).sort()).toEqual([...TEN].sort())
    expect(d2.result.current.budgetItems.map(i => i.id)).toEqual(['v3'])
    expect(d2.result.current.settings.theme).toBe('pastel')
    expect(server.log.some(l => l.includes('import'))).toBe(false)   // nada que importar
    expect(srv.cats).toHaveLength(10)                                  // y nada duplicado
    d2.unmount()

    // ── Tercer usuario: no ve ninguna ──
    localStorage.clear()
    login('otra@u.es', 'Otra', 'tok-otra')
    const d3 = renderHook(() => useSettings(), { wrapper })
    await waitFor(() => expect(d3.result.current.prefsLoaded).toBe(true))
    expect(Object.values(d3.result.current.customCategories).flat()).toEqual([])
    expect(d3.result.current.budgetItems).toEqual([])
    expect(server.users['tok-otra'].cats).toEqual([])
  })

  it('si el servidor falla en el primer login, ninguna de las 6 claves se borra y el siguiente login lo completa', async () => {
    seedRealisticDevice()
    login('u@u.es', 'Usuaria', 'tok-u')
    const realFetch = server.fetch
    let down = true
    vi.stubGlobal('fetch', vi.fn(async (...a) => { if (down) throw new TypeError('Failed to fetch'); return realFetch(...a) }))
    const d1 = renderHook(() => useSettings(), { wrapper })
    await new Promise(r => setTimeout(r, 50))
    for (const k of ALL_LEGACY) expect(localStorage.getItem(k), k).not.toBeNull()
    expect(Object.values(d1.result.current.customCategories).flat()).toHaveLength(10)   // se siguen viendo
    d1.unmount()

    down = false
    const d2 = renderHook(() => useSettings(), { wrapper })
    await waitFor(() => expect(d2.result.current.prefsLoaded).toBe(true))
    expect(server.users['tok-u'].cats).toHaveLength(10)
    for (const k of ALL_LEGACY) expect(localStorage.getItem(k), k).toBeNull()
  })
})
