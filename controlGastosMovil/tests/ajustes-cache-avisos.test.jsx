// SettingsContext: caso C (caché vacía + datos antiguos del mismo dueño +
// servidor caído), alta de categorías repetidas y concordancia de los avisos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { AuthProvider } from '../src/context/AuthContext'
import { SettingsProvider, useSettings, unreadableMsg, unreadableCatsMsg } from '../src/context/SettingsContext'
import { claimLegacy } from '../src/utils/legacyImport'
import {
  AUTH_KEY, CUSTOM_CATS_KEY, BUDGET_KEY, SETTINGS_KEY, CATS_CACHE_KEY, PREFS_CACHE_KEY, LEGACY_KEYS,
} from '../src/utils/storageKeys'

const ANA = 'ana@mail.es'
const LEGACY_BUDGET = [{ id: 'a', name: 'Ocio', limit: 50, month: 1, color: '#fff' }]
const DEFAULT_SETTINGS = { theme: 'dark', accent: '#6366f1', hideAmounts: false, currency: 'EUR', budgetAlerts: true, alertThreshold: 80 }
const NO_PREFS = { settings: null, budgets: null, hidden_categories: null, tour: null, updated_at: {} }

const login = (email) => localStorage.setItem(AUTH_KEY, JSON.stringify({ email, name: 'Ana', sessionToken: 't' }))
const wrapper = ({ children }) => <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
const legacyLeft = () => LEGACY_KEYS.filter(k => localStorage.getItem(k) !== null)

function seedLegacy() {
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify({ 'Gasto Variable': [{ concepto: 'Clínica', emoji: '🏥' }] }))
  localStorage.setItem(BUDGET_KEY, JSON.stringify(LEGACY_BUDGET))
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }))
}
// Caché "vacía" de Ana: lo que queda tras un primer arranque sin nada en el servidor.
function seedEmptyCache(email = ANA) {
  localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify({ email, settings: DEFAULT_SETTINGS, budgets: [], hidden: [], tour: null }))
  localStorage.setItem(CATS_CACHE_KEY, JSON.stringify({ email, categories: [] }))
}
const serverDown = () => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('caso C: caché vacía + datos antiguos pendientes + servidor caído', () => {
  it('se pintan los datos antiguos del mismo dueño y no se borra nada', async () => {
    seedLegacy()
    claimLegacy(ANA)
    seedEmptyCache()
    login(ANA)
    serverDown()
    const { result } = renderHook(() => useSettings(), { wrapper })
    expect(result.current.budgetItems).toEqual(LEGACY_BUDGET)
    expect(result.current.settings.theme).toBe('light')
    expect(result.current.customCategories['Gasto Variable'].map(c => c.concepto)).toEqual(['Clínica'])
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(result.current.prefsLoaded).toBe(false)
    expect(result.current.budgetItems).toEqual(LEGACY_BUDGET)
    expect(result.current.customCategories['Gasto Variable'].map(c => c.concepto)).toEqual(['Clínica'])
    expect(legacyLeft().length).toBe(3)
  })

  it('una caché con datos propios manda sobre los antiguos', () => {
    seedLegacy()
    claimLegacy(ANA)
    const mine = [{ id: 'm', name: 'Comida', limit: 200, month: 0, color: '#000' }]
    localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify({ email: ANA, settings: { ...DEFAULT_SETTINGS, theme: 'pastel' }, budgets: mine, hidden: [], tour: null }))
    localStorage.setItem(CATS_CACHE_KEY, JSON.stringify({ email: ANA, categories: [{ id: '1', tipo: 'Gasto Variable', concepto: 'clinica', emoji: '🩺' }] }))
    login(ANA)
    serverDown()
    const { result } = renderHook(() => useSettings(), { wrapper })
    expect(result.current.budgetItems).toEqual(mine)
    expect(result.current.settings.theme).toBe('pastel')
    // la antigua "Clínica" es la misma que la cacheada "clinica": no se duplica
    expect(result.current.customCategories['Gasto Variable'].map(c => c.concepto)).toEqual(['clinica'])
  })

  it('los datos antiguos de otra persona no se pintan', () => {
    seedLegacy()
    claimLegacy('luis@mail.es')
    seedEmptyCache()
    login(ANA)
    serverDown()
    const { result } = renderHook(() => useSettings(), { wrapper })
    expect(result.current.budgetItems).toEqual([])
    expect(result.current.settings.theme).toBe('dark')
    expect(result.current.customCategories['Gasto Variable']).toEqual([])
  })
})

describe('addCategory', () => {
  function setup(prefs = NO_PREFS, categories = []) {
    login(ANA)
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '')
      const method = opts.method || 'GET'
      calls.push(`${method} ${path}`)
      const res = (status, body) => ({ status, ok: status < 400, json: async () => body })
      if (method === 'GET' && path === '/api/prefs') return res(200, prefs)
      if (method === 'GET' && path === '/api/categories') return res(200, { categories })
      if (method === 'POST' && path === '/api/categories') {
        const b = JSON.parse(opts.body)
        return res(200, { id: 'new', ...b })
      }
      return res(200, { updated_at: 'x' })
    }))
    return { calls, ...renderHook(() => useSettings(), { wrapper }) }
  }
  const posts = (calls) => calls.filter(c => c === 'POST /api/categories')

  it('rechaza (false) un nombre igual a una por defecto, aunque cambie la forma, sin llamar al servidor', async () => {
    const { result, calls } = setup()
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    let out
    act(() => { out = result.current.addCategory('Gasto Variable', { concepto: '  GIMNÁSIO ', emoji: '🏋️' }) })
    expect(out).toBe(false)
    expect(posts(calls)).toEqual([])
  })

  it('rechaza una propia repetida y una vacía', async () => {
    const { result, calls } = setup(NO_PREFS, [{ id: '1', tipo: 'Gasto Variable', concepto: 'Clínica', emoji: '🏥' }])
    await waitFor(() => expect(result.current.customCategories['Gasto Variable']).toHaveLength(1))
    let a, b
    act(() => { a = result.current.addCategory('Gasto Variable', { concepto: 'clinica' }) })
    act(() => { b = result.current.addCategory('Gasto Variable', { concepto: '   ' }) })
    expect(a).toBe(false)
    expect(b).toBe(false)
    expect(posts(calls)).toEqual([])
  })

  it('el mismo nombre en otro tipo sí se permite, y se guarda con espacios normalizados', async () => {
    const { result, calls } = setup()
    await waitFor(() => expect(result.current.prefsLoaded).toBe(true))
    let out
    act(() => { out = result.current.addCategory('Gasto Fijo', { concepto: '  Gimnasio   anual ', emoji: '🏋️' }) })
    expect(out).toBe(true)
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    const body = JSON.parse(fetch.mock.calls.find(([, o]) => o?.method === 'POST')[1].body)
    expect(body).toMatchObject({ tipo: 'Gasto Fijo', concepto: 'Gimnasio anual' })
  })

  it('si la por defecto está oculta, se puede volver a crear con ese nombre', async () => {
    const { result, calls } = setup({ ...NO_PREFS, hidden_categories: [{ tipo: 'Gasto Variable', concepto: 'Gimnasio' }] })
    await waitFor(() => expect(result.current.hiddenCategories).toHaveLength(1))
    let out
    act(() => { out = result.current.addCategory('Gasto Variable', { concepto: 'Gimnasio', emoji: '🏋️' }) })
    expect(out).toBe(true)
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
  })
})

describe('concordancia de los avisos', () => {
  it('unreadableMsg concuerda el verbo', () => {
    expect(unreadableMsg('tus ajustes')).toBe('No se han podido leer tus ajustes del servidor; no se guardarán cambios hasta que se resuelva.')
    expect(unreadableMsg('el estado de la guía', false)).toBe('No se ha podido leer el estado de la guía del servidor; no se guardarán cambios hasta que se resuelva.')
  })

  it('categorías: singular con 1, plural con varias', () => {
    expect(unreadableCatsMsg(1)).toMatch(/^No se ha podido leer una de tus categorías del servidor/)
    expect(unreadableCatsMsg(4)).toMatch(/^No se han podido leer algunas de tus categorías del servidor/)
  })

  function setupUnreadable(prefs, cats) {
    login(ANA)
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '')
      const res = (status, body) => ({ status, ok: status < 400, json: async () => body })
      if (!opts.method && path === '/api/prefs') return res(200, prefs)
      if (!opts.method && path === '/api/categories') return res(200, cats)
      return res(200, { updated_at: 'x' })
    }))
    return renderHook(() => useSettings(), { wrapper })
  }

  it('en la app: guía y una categoría en singular, ajustes en plural', async () => {
    const { result } = setupUnreadable(
      { ...NO_PREFS, unreadable: ['settings', 'tour'] },
      { categories: [], unreadable: 1 },
    )
    await waitFor(() => expect(result.current.syncWarnings).toHaveLength(3))
    expect(result.current.syncWarnings).toEqual([
      'No se han podido leer tus ajustes del servidor; no se guardarán cambios hasta que se resuelva.',
      'No se ha podido leer el estado de la guía del servidor; no se guardarán cambios hasta que se resuelva.',
      'No se ha podido leer una de tus categorías del servidor; no se guardarán cambios hasta que se resuelva.',
    ])
  })

  it('en la app: varias categorías ilegibles en plural', async () => {
    const { result } = setupUnreadable(NO_PREFS, { categories: [], unreadable: 2 })
    await waitFor(() => expect(result.current.syncWarnings).toHaveLength(1))
    expect(result.current.syncWarnings[0]).toMatch(/^No se han podido leer algunas de tus categorías/)
  })
})
