import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { SettingsProvider, useSettings } from '../src/context/SettingsContext'
import { importLegacy, claimLegacy, finalImportBestEffort } from '../src/utils/legacyImport'
import {
  AUTH_KEY, CUSTOM_CATS_KEY, BUDGET_KEY, SETTINGS_KEY, TOUR_KEY, CATS_CACHE_KEY, PREFS_CACHE_KEY,
  LEGACY_OWNER_KEY, LEGACY_KEYS, purgeForeignCaches,
} from '../src/utils/storageKeys'

const NO_PREFS = { settings: null, budgets: null, hidden_categories: null, tour: null, updated_at: {} }
const LEGACY_BUDGET = [{ id: 'a', name: 'Ocio', limit: 50, month: 1, color: '#fff' }]

function seedLegacy() {
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify({ 'Gasto Variable': [{ concepto: 'Clínica', emoji: '🏥' }] }))
  localStorage.setItem(BUDGET_KEY, JSON.stringify(LEGACY_BUDGET))
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }))
  localStorage.setItem(TOUR_KEY, '2026-01-01T00:00:00.000Z')
}
const legacyLeft = () => LEGACY_KEYS.filter(k => localStorage.getItem(k) !== null)
const login = (email, name = 'X') => localStorage.setItem(AUTH_KEY, JSON.stringify({ email, name, sessionToken: 't' }))

function makeApi(overrides = {}) {
  return {
    importCategories: vi.fn(async items => ({ imported: items.length, skipped: 0, categories: items.map((c, i) => ({ id: String(i), ...c })) })),
    putPref: vi.fn(async () => ({ updated_at: 'now' })),
    ...overrides,
  }
}

describe('claves antiguas ligadas a su dueño', () => {
  beforeEach(() => { localStorage.clear(); seedLegacy() })

  it('la primera vez que se ven tras un login se anota el dueño (en minúsculas)', () => {
    expect(claimLegacy('Ana@Mail.es')).toBe(true)
    expect(localStorage.getItem(LEGACY_OWNER_KEY)).toBe('ana@mail.es')
    expect(claimLegacy('ana@mail.es')).toBe(true)
  })

  it('otro usuario del móvil no ve ni importa los datos antiguos, y se conservan', async () => {
    claimLegacy('ana@mail.es')
    const before = legacyLeft()
    expect(claimLegacy('luis@mail.es')).toBe(false)
    const api = makeApi()
    const out = await importLegacy({ user: { name: 'Luis', email: 'luis@mail.es' }, prefs: NO_PREFS, api })
    expect(api.importCategories).not.toHaveBeenCalled()
    expect(api.putPref.mock.calls.map(c => c[0])).toEqual(['hidden_categories']) // la regla por nombre no sale del móvil
    expect(out.failed).toEqual([])
    expect(legacyLeft()).toEqual(before)
    expect(localStorage.getItem(LEGACY_OWNER_KEY)).toBe('ana@mail.es')
  })

  it('el dueño sigue pudiendo importarlos después y entonces desaparece la marca', async () => {
    claimLegacy('ana@mail.es')
    await importLegacy({ user: { name: 'Luis', email: 'luis@mail.es' }, prefs: NO_PREFS, api: makeApi() })
    const api = makeApi()
    await importLegacy({ user: { name: 'Ana', email: 'ana@mail.es' }, prefs: NO_PREFS, api })
    expect(api.importCategories).toHaveBeenCalledTimes(1)
    expect(legacyLeft()).toEqual([])
    expect(localStorage.getItem(LEGACY_OWNER_KEY)).toBeNull()
  })

  it('en la app: otro usuario no ve las categorías/presupuestos antiguos ni se suben a su cuenta', async () => {
    claimLegacy('ana@mail.es')
    login('luis@mail.es', 'Luis')
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '')
      calls.push(`${opts.method || 'GET'} ${path}`)
      if (path === '/api/prefs') return { status: 200, ok: true, json: async () => NO_PREFS }
      if (path === '/api/categories') return { status: 200, ok: true, json: async () => ({ categories: [] }) }
      return { status: 200, ok: true, json: async () => ({ updated_at: 'x' }) }
    }))
    const wrapper = ({ children }) => <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
    const { result } = renderHook(() => useSettings(), { wrapper })
    expect(result.current.budgetItems).toEqual([])
    expect(result.current.customCategories['Gasto Variable']).toEqual([])
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    expect(result.current.budgetItems).toEqual([])
    expect(calls).not.toContain('POST /api/categories/import')
    expect(calls).not.toContain('PUT /api/prefs/budgets')
    expect(legacyLeft().length).toBe(4)
    vi.unstubAllGlobals()
  })
})

describe('último import al cerrar sesión', () => {
  beforeEach(() => { localStorage.clear(); seedLegacy() })
  afterEach(() => vi.unstubAllGlobals())
  const user = { name: 'Ana', email: 'ana@mail.es' }

  it('si el servidor responde, importa y limpia las claves antiguas', async () => {
    const api = makeApi()
    const out = await finalImportBestEffort({
      user, api, fetchPrefs: async () => NO_PREFS, fetchCategories: async () => ({ categories: [] }),
    })
    expect(out.failed).toEqual([])
    expect(legacyLeft()).toEqual([])
  })

  it('si el servidor no contesta a tiempo no borra nada y siguen ligadas a su dueño', async () => {
    const never = () => new Promise(() => {})
    const out = await finalImportBestEffort({
      user, api: makeApi(), fetchPrefs: never, fetchCategories: never, timeoutMs: 20,
    })
    expect(out).toBeNull()
    expect(legacyLeft().length).toBe(4)
    expect(localStorage.getItem(LEGACY_OWNER_KEY)).toBe('ana@mail.es')
  })

  it('no importa las claves de otro dueño', async () => {
    claimLegacy('luis@mail.es')
    const api = makeApi()
    const out = await finalImportBestEffort({ user, api, fetchPrefs: async () => NO_PREFS, fetchCategories: async () => ({}) })
    expect(out).toBeNull()
    expect(api.importCategories).not.toHaveBeenCalled()
    expect(legacyLeft().length).toBe(4)
  })

  it('logout() hace el import antes de borrar la sesión (con el token aún puesto)', async () => {
    login('ana@mail.es', 'Ana')
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '')
      seen.push([`${opts.method || 'GET'} ${path}`, !!localStorage.getItem(AUTH_KEY)])
      if (path === '/api/prefs' && !opts.method) return { status: 200, ok: true, json: async () => NO_PREFS }
      if (path === '/api/categories' && !opts.method) return { status: 200, ok: true, json: async () => ({ categories: [] }) }
      if (path === '/api/categories/import') return { status: 200, ok: true, json: async () => ({ categories: [{ id: '1', tipo: 'Gasto Variable', concepto: 'Clínica' }] }) }
      return { status: 200, ok: true, json: async () => ({ updated_at: 'x' }) }
    }))
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await act(async () => { await result.current.logout() })
    expect(seen.some(([c]) => c === 'POST /api/categories/import')).toBe(true)
    expect(seen.every(([, hadToken]) => hadToken)).toBe(true)
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem(AUTH_KEY)).toBeNull()
    expect(legacyLeft()).toEqual([])
  })
})

describe('datos ilegibles en el servidor', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => vi.unstubAllGlobals())

  it('importLegacy no sube ni borra lo local de un kind ilegible', async () => {
    seedLegacy()
    const api = makeApi()
    const out = await importLegacy({
      user: { name: 'Ana', email: 'ana@mail.es' },
      prefs: { ...NO_PREFS, budgets: null, unreadable: ['budgets', 'hidden_categories'] },
      api,
    })
    const kinds = api.putPref.mock.calls.map(c => c[0])
    expect(kinds).not.toContain('budgets')
    expect(kinds).not.toContain('hidden_categories')
    expect(kinds).toEqual(expect.arrayContaining(['settings', 'tour']))
    expect(localStorage.getItem(BUDGET_KEY)).not.toBeNull()
    expect(out.unreadable).toEqual(['budgets', 'hidden_categories'])
  })

  it('con categorías ilegibles no se importan ni se marca completa la importación', async () => {
    seedLegacy()
    const api = makeApi()
    const out = await importLegacy({
      user: { name: 'Ana', email: 'ana@mail.es' }, prefs: NO_PREFS, api, catsUnreadable: 2,
    })
    expect(api.importCategories).not.toHaveBeenCalled()
    expect(out.failed).toContain('categories')
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).not.toBeNull()
  })

  function setup({ prefs, cats = { categories: [] }, putStatus = 200 }) {
    login('ana@mail.es', 'Ana')
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const path = String(url)
      const method = opts.method || 'GET'
      calls.push(`${method} ${path.replace(/^https?:\/\/[^/]+/, '')}`)
      const res = (status, body) => ({ status, ok: status < 400, json: async () => body })
      if (method === 'GET' && path.endsWith('/api/prefs')) return res(200, prefs)
      if (method === 'GET' && path.endsWith('/api/categories')) return res(200, cats)
      if (method === 'PUT') return putStatus === 409 ? res(409, { detail: 'dato_ilegible' }) : res(200, { updated_at: 'x' })
      return res(404, {})
    }))
    const wrapper = ({ children }) => <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
    return { calls, ...renderHook(() => useSettings(), { wrapper }) }
  }

  it('un kind ilegible muestra el aviso, bloquea la edición y no escribe nada', async () => {
    const { result, calls } = setup({ prefs: { ...NO_PREFS, unreadable: ['budgets'] } })
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    expect(result.current.budgetsLocked).toBe(true)
    expect(result.current.syncWarnings).toEqual([
      'No se han podido leer tus presupuestos del servidor; no se guardarán cambios hasta que se resuelva.',
    ])
    act(() => result.current.updateBudgets(prev => [...prev, { id: 'n', name: 'N', limit: 1, month: 0 }]))
    expect(result.current.budgetItems).toEqual([])
    expect(result.current.syncNotice.msg).toMatch(/No se han podido leer tus presupuestos/)
    expect(calls.filter(c => c.startsWith('PUT') && c.includes('budgets'))).toEqual([])
  })

  it('un kind ilegible no se trata como "el servidor no tiene nada": no se sube lo local', async () => {
    seedLegacy()
    const { result, calls } = setup({ prefs: { ...NO_PREFS, unreadable: ['budgets'] } })
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    expect(calls).not.toContain('PUT /api/prefs/budgets')
    expect(result.current.budgetItems).toEqual(LEGACY_BUDGET)
    expect(localStorage.getItem(BUDGET_KEY)).not.toBeNull()
  })

  it('categorías ilegibles: aviso y la importación queda pendiente', async () => {
    seedLegacy()
    const { result, calls } = setup({ prefs: NO_PREFS, cats: { categories: [], unreadable: 3 } })
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    expect(result.current.syncWarnings[0]).toMatch(/algunas de tus categorías/)
    expect(calls).not.toContain('POST /api/categories/import')
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).not.toBeNull()
  })

  it('409 dato_ilegible al guardar revierte el cambio, avisa y nunca usa force', async () => {
    const { result, calls } = setup({ prefs: { ...NO_PREFS, budgets: { version: 3, items: [] } }, putStatus: 409 })
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    act(() => result.current.updateBudgets(prev => [...prev, { id: 'n', name: 'N', limit: 1, month: 0 }]))
    await waitFor(() => expect(result.current.budgetItems).toEqual([]))
    expect(result.current.syncNotice.msg).toMatch(/No se han podido leer tus presupuestos/)
    expect(result.current.budgetsLocked).toBe(true)
    expect(calls.some(c => c.includes('force'))).toBe(false)
  })
})

describe('cachés de otra persona', () => {
  beforeEach(() => localStorage.clear())

  it('purgeForeignCaches borra las etiquetadas con otro email y deja las propias', () => {
    localStorage.setItem(CATS_CACHE_KEY, JSON.stringify({ email: 'ana@mail.es', categories: [] }))
    localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify({ email: 'luis@mail.es', budgets: [] }))
    purgeForeignCaches('luis@mail.es')
    expect(localStorage.getItem(CATS_CACHE_KEY)).toBeNull()
    expect(localStorage.getItem(PREFS_CACHE_KEY)).not.toBeNull()
  })

  it('al entrar otro usuario se borran en el dispositivo las cachés de la persona anterior', async () => {
    localStorage.setItem(CATS_CACHE_KEY, JSON.stringify({ email: 'ana@mail.es', categories: [] }))
    localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify({ email: 'ana@mail.es', budgets: LEGACY_BUDGET }))
    login('luis@mail.es', 'Luis')
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 404, ok: false, json: async () => ({}) })))
    const wrapper = ({ children }) => <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
    const { result } = renderHook(() => useSettings(), { wrapper })
    expect(result.current.budgetItems).toEqual([])
    await waitFor(() => expect(localStorage.getItem(PREFS_CACHE_KEY)).toBeNull())
    expect(localStorage.getItem(CATS_CACHE_KEY)).toBeNull()
    vi.unstubAllGlobals()
  })
})
