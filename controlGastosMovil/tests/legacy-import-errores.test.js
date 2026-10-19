import { describe, it, expect, beforeEach, vi } from 'vitest'
import { importLegacy } from '../src/utils/legacyImport'
import {
  BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1, CUSTOM_CATS_KEY, SETTINGS_KEY, TOUR_KEY,
} from '../src/utils/storageKeys'

// Errores del servidor a mitad de la importación única: nunca se pierde una
// clave antigua que el servidor no haya confirmado.

const NO_PREFS = { settings: null, budgets: null, hidden_categories: null, tour: null, updated_at: {} }
const httpErr = (status) => Object.assign(new Error(`API ${status}`), { status })
const remaining = () => [CUSTOM_CATS_KEY, BUDGET_KEY, SETTINGS_KEY, TOUR_KEY].filter(k => localStorage.getItem(k) !== null)

// Servidor falso con estado: importación idempotente por (tipo, concepto).
function statefulApi({ failImportOnCall = [], importError = () => new TypeError('Failed to fetch'), putError = null } = {}) {
  const st = { cats: [], prefs: {}, importCalls: 0 }
  const api = {
    importCategories: vi.fn(async items => {
      st.importCalls++
      if (failImportOnCall.includes(st.importCalls)) throw importError()
      let imported = 0, skipped = 0
      for (const it of items) {
        if (st.cats.some(c => c.tipo === it.tipo && c.concepto === it.concepto)) skipped++
        else { st.cats.push({ id: String(st.cats.length + 1), ...it }); imported++ }
      }
      return { imported, skipped, categories: [...st.cats] }
    }),
    putPref: vi.fn(async (kind, data) => {
      if (putError) { const e = putError(kind); if (e) throw e }
      st.prefs[kind] = data
      return { updated_at: 'now' }
    }),
  }
  return { st, api }
}

function seedCats(n) {
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify({
    'Gasto Variable': Array.from({ length: n }, (_, i) => ({ concepto: `Cat ${i}`, emoji: '🙂' })),
  }))
}

describe('importación única: errores del servidor', () => {
  beforeEach(() => { localStorage.clear() })

  it.each([
    ['409', 409],
    ['422', 422],
    ['413', 413],
  ])('un %s al importar categorías no borra la clave antigua y no impide subir lo demás', async (_n, status) => {
    seedCats(3)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }))
    const { api, st } = statefulApi()
    api.importCategories.mockImplementation(async () => { throw httpErr(status) })
    const out = await importLegacy({ user: { name: 'M' }, prefs: NO_PREFS, api })
    expect(out.failed).toContain('categories')
    expect(out.categories).toBeNull()
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).not.toBeNull()
    // los ajustes sí estaban confirmados por el servidor
    expect(st.prefs.settings).toEqual({ theme: 'light' })
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull()
  })

  it('un 422 en un presupuesto no borra su clave (v3/v2/v1 siguen) y lo demás sigue', async () => {
    localStorage.setItem(BUDGET_KEY, JSON.stringify([{ id: 'a', name: 'Ocio', limit: 5, month: 1, color: '#fff' }]))
    localStorage.setItem(BUDGET_KEY_V2, JSON.stringify([{ id: 'b', name: 'X', limit: 5 }]))
    localStorage.setItem(BUDGET_KEY_V1, JSON.stringify([{ id: 'c', name: 'Y', limit: 5 }]))
    localStorage.setItem(TOUR_KEY, '2026-01-01T00:00:00.000Z')
    const { api, st } = statefulApi({ putError: kind => (kind === 'budgets' ? httpErr(422) : null) })
    const out = await importLegacy({ user: { name: 'M' }, prefs: NO_PREFS, api })
    expect(out.failed).toEqual(['budgets'])
    for (const k of [BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1]) expect(localStorage.getItem(k), k).not.toBeNull()
    expect(localStorage.getItem(TOUR_KEY)).toBeNull()
    expect(st.prefs.tour).toEqual({ seen_at: '2026-01-01T00:00:00.000Z' })
  })

  it('un fallo de red en el 2.º lote y un reintento no duplican categorías', async () => {
    seedCats(450)
    const { api, st } = statefulApi({ failImportOnCall: [2] })
    const first = await importLegacy({ user: { name: 'M' }, prefs: null, api })
    expect(first.failed).toContain('categories')
    expect(st.cats).toHaveLength(200)                       // solo el 1.er lote llegó
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).not.toBeNull()

    const second = await importLegacy({ user: { name: 'M' }, prefs: null, api })
    expect(second.failed).toEqual([])
    expect(st.cats).toHaveLength(450)                       // sin duplicados
    expect(new Set(st.cats.map(c => c.concepto)).size).toBe(450)
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).toBeNull()

    const third = await importLegacy({ user: { name: 'M' }, prefs: null, api })  // ya no hay nada que subir
    expect(third.categories).toBeNull()
    expect(api.importCategories).toHaveBeenCalledTimes(2 + 3)
  })

  it('reintento tras caída total: la segunda pasada sube todo una sola vez', async () => {
    seedCats(4)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'pastel' }))
    localStorage.setItem(BUDGET_KEY, JSON.stringify([{ id: 'a', name: 'O', limit: 1, month: 0, color: '#fff' }]))
    localStorage.setItem(TOUR_KEY, 'x')
    let down = true
    const { api, st } = statefulApi({ putError: () => (down ? new TypeError('Failed to fetch') : null) })
    const realImport = api.importCategories.getMockImplementation()
    api.importCategories.mockImplementation(async items => { if (down) throw new TypeError('Failed to fetch'); return realImport(items) })
    const before = remaining()
    await importLegacy({ user: { name: 'M' }, prefs: NO_PREFS, api })
    expect(remaining()).toEqual(before)
    down = false
    const out = await importLegacy({ user: { name: 'M' }, prefs: NO_PREFS, api })
    expect(out.failed).toEqual([])
    expect(st.cats).toHaveLength(4)
    expect(remaining()).toEqual([])
  })

  it('un 401 en mitad de la importación solo deja borradas las claves ya confirmadas', async () => {
    seedCats(2)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }))
    localStorage.setItem(BUDGET_KEY, JSON.stringify([{ id: 'a', name: 'O', limit: 1, month: 0, color: '#fff' }]))
    localStorage.setItem(TOUR_KEY, 'x')
    // categorías y ajustes llegan; luego caduca la sesión (apiJson lanza sin .status)
    const { api, st } = statefulApi({
      putError: kind => (kind === 'settings' ? null : new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.')),
    })
    const out = await importLegacy({ user: { name: 'M' }, prefs: NO_PREFS, api })
    expect(st.cats).toHaveLength(2)
    expect(st.prefs.settings).toEqual({ theme: 'light' })
    expect(out.failed).toEqual(expect.arrayContaining(['budgets', 'tour']))
    expect(remaining().sort()).toEqual([BUDGET_KEY, TOUR_KEY].sort())   // categorías y ajustes ya confirmados
  })

  it('un 401 desde la primera llamada no borra ninguna clave antigua', async () => {
    seedCats(2)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }))
    localStorage.setItem(BUDGET_KEY, JSON.stringify([{ id: 'a', name: 'O', limit: 1, month: 0, color: '#fff' }]))
    localStorage.setItem(TOUR_KEY, 'x')
    const expired = () => new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.')
    const { api } = statefulApi({ putError: expired })
    api.importCategories.mockImplementation(async () => { throw expired() })
    const before = remaining()
    await importLegacy({ user: { name: 'M' }, prefs: NO_PREFS, api })
    expect(remaining()).toEqual(before)
  })

  it('clave de categorías ilegible: no se toca ni se llama al servidor para ella', async () => {
    localStorage.setItem(CUSTOM_CATS_KEY, '{no es json')
    const { api } = statefulApi()
    const out = await importLegacy({ user: { name: 'M' }, prefs: null, api })
    expect(out.failed).toContain('categories')
    expect(api.importCategories).not.toHaveBeenCalled()
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).toBe('{no es json')
  })
})
