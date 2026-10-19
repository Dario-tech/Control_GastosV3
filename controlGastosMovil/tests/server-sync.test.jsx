import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider } from '../src/context/AuthContext'
import { SettingsProvider, useSettings } from '../src/context/SettingsContext'
import { SESSION_EXPIRED_EVENT } from '../src/services/api'
import { AUTH_KEY, CUSTOM_CATS_KEY, BUDGET_KEY, SETTINGS_KEY, TOUR_KEY, CATS_CACHE_KEY, PREFS_CACHE_KEY } from '../src/utils/storageKeys'

// Servidor falso en memoria: categorías y preferencias por usuario.
function makeServer({ down = false, notFound = false } = {}) {
  const s = {
    down, notFound, cats: [], prefs: { settings: null, budgets: null, hidden_categories: null, tour: null },
    calls: [], nextId: 1, unauthorized: false,
  }
  s.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    const method = opts.method || 'GET'
    s.calls.push(`${method} ${path}`)
    const res = (status, body = {}) => ({ status, ok: status < 400, json: async () => body })
    if (s.down) throw new TypeError('Failed to fetch')
    if (s.unauthorized) return res(401)
    if (s.notFound) return res(404, { detail: 'Not Found' })
    const body = opts.body ? JSON.parse(opts.body) : null
    if (path === '/api/prefs' && method === 'GET') return res(200, { ...s.prefs, updated_at: {} })
    const m = path.match(/^\/api\/prefs\/(\w+)$/)
    if (m && method === 'PUT') { s.prefs[m[1]] = body.data; return res(200, { updated_at: 'now' }) }
    if (path === '/api/categories' && method === 'GET') return res(200, { categories: s.cats })
    if (path === '/api/categories' && method === 'POST') {
      if (s.cats.some(c => c.tipo === body.tipo && c.concepto === body.concepto)) return res(409, { detail: 'duplicada' })
      const item = { id: String(s.nextId++), emoji: '', ...body }
      s.cats.push(item)
      return res(201, item)
    }
    if (path === '/api/categories/import') {
      let imported = 0, skipped = 0
      for (const it of body.items) {
        if (s.cats.some(c => c.tipo === it.tipo && c.concepto === it.concepto)) skipped++
        else { s.cats.push({ id: String(s.nextId++), emoji: '', ...it }); imported++ }
      }
      return res(200, { imported, skipped, categories: s.cats })
    }
    const d = path.match(/^\/api\/categories\/(\w+)$/)
    if (d && method === 'DELETE') { s.cats = s.cats.filter(c => c.id !== d[1]); return res(204) }
    return res(404)
  })
  return s
}

const wrapper = ({ children }) => <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
const useBoth = () => useSettings()
const login = (name = 'Mario', email = 'm@m.es') =>
  localStorage.setItem(AUTH_KEY, JSON.stringify({ email, name, sessionToken: 't' }))

const LEGACY_CATS = { 'Gasto Variable': [{ concepto: 'Clínica', emoji: '🏥' }] }
const LEGACY_BUDGET = [{ id: 'a', name: 'Ocio', limit: 50, month: 1, color: '#fff' }]

function seedLegacy() {
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(LEGACY_CATS))
  localStorage.setItem(BUDGET_KEY, JSON.stringify(LEGACY_BUDGET))
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }))
  localStorage.setItem(TOUR_KEY, '2026-01-01T00:00:00.000Z')
}

describe('SettingsProvider con servidor', () => {
  let server
  beforeEach(() => { localStorage.clear(); login() })
  afterEach(() => vi.unstubAllGlobals())
  const setup = (opts) => { server = makeServer(opts); vi.stubGlobal('fetch', server.fetch); return renderHook(useBoth, { wrapper }) }

  it('tras el login importa lo antiguo al servidor y borra las claves antiguas', async () => {
    seedLegacy()
    const { result } = setup()
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    expect(server.cats.map(c => c.concepto)).toEqual(['Clínica'])
    expect(server.prefs.budgets.items).toHaveLength(1)
    expect(server.prefs.settings).toEqual({ theme: 'light' })
    expect(server.prefs.tour.seen_at).toBe('2026-01-01T00:00:00.000Z')
    for (const k of [CUSTOM_CATS_KEY, BUDGET_KEY, SETTINGS_KEY, TOUR_KEY]) expect(localStorage.getItem(k), k).toBeNull()
    expect(result.current.customCategories['Gasto Variable'][0]).toMatchObject({ concepto: 'Clínica', id: '1' })
    expect(result.current.settings.theme).toBe('light')
    expect(result.current.tourSeen).toBe(true)
  })

  it('reabrir la app no duplica nada (idempotente)', async () => {
    seedLegacy()
    const first = setup()
    await waitFor(() => expect(first.result.current.prefsLoaded).toBe(true))
    first.unmount()
    server.calls.length = 0
    const second = renderHook(useBoth, { wrapper })
    await waitFor(() => expect(second.result.current.prefsLoaded).toBe(true))
    expect(server.cats).toHaveLength(1)
    expect(server.calls.some(c => c.includes('import') || c.startsWith('PUT'))).toBe(false)
  })

  it('el servidor gana si ya tiene presupuestos y ajustes', async () => {
    seedLegacy()
    const { result } = (() => { server = makeServer(); server.prefs.settings = { theme: 'dark', accent: '#f43f5e' }; server.prefs.budgets = { version: 3, items: [] }; vi.stubGlobal('fetch', server.fetch); return renderHook(useBoth, { wrapper }) })()
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    expect(result.current.settings.theme).toBe('dark')
    expect(result.current.budgetItems).toEqual([])
    expect(server.prefs.budgets.items).toEqual([])
    expect(localStorage.getItem(BUDGET_KEY)).toBeNull()
  })

  it.each([
    ['servidor caído', { down: true }],
    ['404 (backend sin desplegar)', { notFound: true }],
  ])('con %s no se borra ninguna clave antigua y se siguen viendo los datos', async (_n, opts) => {
    seedLegacy()
    const { result } = setup(opts)
    await waitFor(() => expect(server.fetch).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 30))
    for (const k of [CUSTOM_CATS_KEY, BUDGET_KEY, SETTINGS_KEY, TOUR_KEY]) expect(localStorage.getItem(k), k).not.toBeNull()
    expect(result.current.customCategories['Gasto Variable']).toHaveLength(1)
    expect(result.current.budgetItems).toHaveLength(1)
    expect(result.current.prefsLoaded).toBe(false)
  })

  it('un 401 cierra sesión sin borrar categorías ni presupuestos antiguos', async () => {
    seedLegacy()
    server = makeServer(); server.unauthorized = true
    vi.stubGlobal('fetch', server.fetch)
    const { result } = renderHook(useBoth, { wrapper })
    await waitFor(() => expect(localStorage.getItem(AUTH_KEY)).toBeNull())
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).not.toBeNull()
    expect(localStorage.getItem(BUDGET_KEY)).not.toBeNull()
    expect(localStorage.getItem(SETTINGS_KEY)).not.toBeNull()
    void result
  })

  it('un evento de sesión caducada no borra lo antiguo', async () => {
    seedLegacy()
    setup({ down: true })
    act(() => { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)) })
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).not.toBeNull()
    expect(localStorage.getItem(BUDGET_KEY)).not.toBeNull()
  })

  it('usuario con la regla antigua (Julia): se sube su lista de ocultas una vez', async () => {
    localStorage.clear(); login('Julia', 'j@j.es')
    const { result } = setup()
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    expect(server.prefs.hidden_categories).toEqual([
      { tipo: 'Gasto Fijo', concepto: 'Inversiones' }, { tipo: 'Gasto Fijo', concepto: 'Cripto' },
    ])
    expect(result.current.hiddenCategories).toHaveLength(2)
  })

  it('crear una categoría es optimista y queda en el servidor; si falla se revierte con aviso', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    act(() => result.current.addCategory('Gasto Variable', { concepto: 'Mascotas', emoji: '🐾' }))
    expect(result.current.customCategories['Gasto Variable'].map(c => c.concepto)).toEqual(['Mascotas'])
    await waitFor(() => expect(server.cats).toHaveLength(1))
    await waitFor(() => expect(result.current.customCategories['Gasto Variable'][0].id).toBe('1'))

    server.down = true
    act(() => result.current.addCategory('Gasto Variable', { concepto: 'Viajes', emoji: '🧳' }))
    await waitFor(() => expect(result.current.customCategories['Gasto Variable'].map(c => c.concepto)).toEqual(['Mascotas']))
    expect(result.current.syncNotice.msg).toMatch(/No se pudo crear/)
  })

  it('borrar una categoría la quita del servidor; si falla se restaura', async () => {
    server = makeServer(); server.cats = [{ id: '9', tipo: 'Gasto Variable', concepto: 'Clínica', emoji: '🏥' }]
    vi.stubGlobal('fetch', server.fetch)
    const { result } = renderHook(useBoth, { wrapper })
    await waitFor(() => expect(result.current.customCategories['Gasto Variable']).toHaveLength(1))
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))

    server.down = true
    await act(async () => { await result.current.removeCategory('Gasto Variable', 'Clínica') })
    expect(result.current.customCategories['Gasto Variable']).toHaveLength(1)
    expect(result.current.syncNotice.msg).toMatch(/No se pudo eliminar/)

    server.down = false
    await act(async () => { await result.current.removeCategory('Gasto Variable', 'Clínica') })
    expect(server.cats).toEqual([])
    expect(result.current.customCategories['Gasto Variable']).toEqual([])
  })

  it('un ajuste fallido vuelve al valor anterior del servidor y avisa', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    act(() => result.current.update('accent', '#10b981'))
    expect(result.current.settings.accent).toBe('#10b981')
    await waitFor(() => expect(server.prefs.settings?.accent).toBe('#10b981'))

    server.down = true
    act(() => result.current.update('accent', '#f43f5e'))
    expect(result.current.settings.accent).toBe('#f43f5e')
    await waitFor(() => expect(result.current.settings.accent).toBe('#10b981'))
    expect(result.current.syncNotice.msg).toMatch(/No se pudo guardar/)
  })

  it('la caché local se escribe por usuario y otro usuario no la ve', async () => {
    const a = setup()
    await waitFor(() => expect(a.result.current.prefsLoaded).toBe(true))
    act(() => a.result.current.addCategory('Ingreso', { concepto: 'Venta', emoji: '💸' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(CATS_CACHE_KEY)).categories).toHaveLength(1))
    expect(JSON.parse(localStorage.getItem(PREFS_CACHE_KEY)).email).toBe('m@m.es')
    a.unmount()

    localStorage.setItem(AUTH_KEY, JSON.stringify({ email: 'b@b.es', name: 'B', sessionToken: 't2' }))
    server = makeServer({ down: true }); vi.stubGlobal('fetch', server.fetch)
    const b = renderHook(useBoth, { wrapper })
    expect(b.result.current.customCategories['Ingreso']).toEqual([])
  })
})
