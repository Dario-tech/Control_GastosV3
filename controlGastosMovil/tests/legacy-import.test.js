import { describe, it, expect, beforeEach, vi } from 'vitest'
import { importLegacy, legacyHiddenFor } from '../src/utils/legacyImport'
import { mergeCategories, DEFAULT_CATEGORIES } from '../src/data/categories'
import {
  BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1, CUSTOM_CATS_KEY, SETTINGS_KEY, TOUR_KEY,
} from '../src/utils/storageKeys'

const NO_PREFS = { settings: null, budgets: null, hidden_categories: null, tour: null, updated_at: {} }

function seed() {
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify({
    'Gasto Variable': [{ concepto: 'Clínica', emoji: '🏥' }],
    'Gasto Fijo': [{ concepto: 'Seguro', emoji: '🛡️' }],
  }))
  localStorage.setItem(BUDGET_KEY, JSON.stringify([{ id: 'a', name: 'Ocio', limit: 50, month: 1, color: '#fff' }]))
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }))
  localStorage.setItem(TOUR_KEY, '2026-01-01T00:00:00.000Z')
}

function makeApi(overrides = {}) {
  return {
    importCategories: vi.fn(async items => ({ imported: items.length, skipped: 0, categories: items.map((c, i) => ({ id: String(i), ...c })) })),
    putPref: vi.fn(async () => ({ updated_at: 'now' })),
    ...overrides,
  }
}

const LEGACY = [CUSTOM_CATS_KEY, BUDGET_KEY, SETTINGS_KEY, TOUR_KEY]
const remaining = () => LEGACY.filter(k => localStorage.getItem(k) !== null)

describe('importación única de datos antiguos', () => {
  beforeEach(() => { localStorage.clear(); seed() })

  it('sube categorías, presupuestos, ajustes y tour, y solo entonces borra las claves antiguas', async () => {
    const api = makeApi()
    const out = await importLegacy({ user: { name: 'Mario' }, prefs: NO_PREFS, api })
    expect(api.importCategories).toHaveBeenCalledTimes(1)
    expect(api.importCategories.mock.calls[0][0]).toEqual([
      { tipo: 'Gasto Variable', concepto: 'Clínica', emoji: '🏥' },
      { tipo: 'Gasto Fijo', concepto: 'Seguro', emoji: '🛡️' },
    ])
    const kinds = api.putPref.mock.calls.map(c => c[0])
    expect(kinds).toEqual(['settings', 'budgets', 'hidden_categories', 'tour'])
    expect(api.putPref.mock.calls[1][1]).toMatchObject({ version: 3, items: [{ id: 'a' }] })
    expect(out.failed).toEqual([])
    expect(remaining()).toEqual([])
  })

  it('es idempotente: la segunda pasada no vuelve a llamar al servidor', async () => {
    await importLegacy({ user: { name: 'Mario' }, prefs: NO_PREFS, api: makeApi() })
    const api2 = makeApi()
    const prefs2 = { ...NO_PREFS, hidden_categories: [] }
    await importLegacy({ user: { name: 'Mario' }, prefs: prefs2, api: api2 })
    expect(api2.importCategories).not.toHaveBeenCalled()
    expect(api2.putPref).not.toHaveBeenCalled()
  })

  it('si el servidor ya tiene datos, gana el servidor: no se sube lo antiguo pero se limpia', async () => {
    const api = makeApi()
    const prefs = { settings: { theme: 'dark' }, budgets: { version: 3, items: [] }, hidden_categories: [], tour: { seen_at: 'x' }, updated_at: {} }
    await importLegacy({ user: { name: 'Mario' }, prefs, api })
    expect(api.putPref).not.toHaveBeenCalled()
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull()
    expect(localStorage.getItem(BUDGET_KEY)).toBeNull()
    expect(localStorage.getItem(TOUR_KEY)).toBeNull()
  })

  it.each([
    ['error 500', () => Object.assign(new Error('API 500'), { status: 500 })],
    ['404 (backend sin desplegar)', () => Object.assign(new Error('API 404'), { status: 404 })],
    ['sin red', () => new TypeError('Failed to fetch')],
  ])('con %s no se borra nada y queda para reintentar', async (_n, mkErr) => {
    const api = makeApi({
      importCategories: vi.fn(async () => { throw mkErr() }),
      putPref: vi.fn(async () => { throw mkErr() }),
    })
    const before = remaining()
    const out = await importLegacy({ user: { name: 'Mario' }, prefs: NO_PREFS, api })
    expect(remaining()).toEqual(before)
    expect(out.failed).toEqual(expect.arrayContaining(['categories', 'settings', 'budgets', 'hidden_categories', 'tour']))
  })

  it('si GET /api/prefs falló (prefs null) solo importa categorías y no borra lo demás', async () => {
    const api = makeApi()
    await importLegacy({ user: { name: 'Mario' }, prefs: null, api })
    expect(api.putPref).not.toHaveBeenCalled()
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).toBeNull()
    expect(remaining().sort()).toEqual([BUDGET_KEY, SETTINGS_KEY, TOUR_KEY].sort())
  })

  it('un fallo parcial borra solo lo confirmado', async () => {
    const api = makeApi({
      putPref: vi.fn(async kind => { if (kind === 'budgets') throw new Error('API 500'); return { updated_at: 'x' } }),
    })
    await importLegacy({ user: { name: 'Mario' }, prefs: NO_PREFS, api })
    expect(remaining()).toEqual([BUDGET_KEY])
  })

  it('respuesta sin lista de categorías no cuenta como éxito', async () => {
    const api = makeApi({ importCategories: vi.fn(async () => ({})) })
    await importLegacy({ user: { name: 'Mario' }, prefs: null, api })
    expect(localStorage.getItem(CUSTOM_CATS_KEY)).not.toBeNull()
  })

  it('trocea las categorías en lotes de 200', async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({ concepto: `C${i}`, emoji: '🙂' }))
    localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify({ 'Gasto Variable': many }))
    const api = makeApi()
    await importLegacy({ user: { name: 'Mario' }, prefs: null, api })
    expect(api.importCategories.mock.calls.map(c => c[0].length)).toEqual([200, 200, 50])
  })

  it('convierte los presupuestos v1/v2 con la cadena de migración antes de subirlos', async () => {
    localStorage.removeItem(BUDGET_KEY)
    localStorage.setItem(BUDGET_KEY_V2, JSON.stringify([{ id: '1', name: 'X', limit: 5 }]))
    localStorage.setItem(BUDGET_KEY_V1, JSON.stringify([{ id: '2', name: 'Y', limit: 6 }]))
    const api = makeApi()
    await importLegacy({ user: { name: 'Mario' }, prefs: NO_PREFS, api })
    const sent = api.putPref.mock.calls.find(c => c[0] === 'budgets')[1]
    expect(sent.items).toHaveLength(1)
    expect(sent.items[0]).toMatchObject({ id: '1', month: new Date().getMonth(), color: expect.any(String) })
    expect(localStorage.getItem(BUDGET_KEY_V2)).toBeNull()
    expect(localStorage.getItem(BUDGET_KEY_V1)).toBeNull()
  })
})

describe('regla antigua de categorías ocultas', () => {
  beforeEach(() => localStorage.clear())

  it('se convierte una sola vez a lista {tipo, concepto} según el nombre', async () => {
    expect(legacyHiddenFor('Julia García')).toEqual([
      { tipo: 'Gasto Fijo', concepto: 'Inversiones' },
      { tipo: 'Gasto Fijo', concepto: 'Cripto' },
    ])
    expect(legacyHiddenFor('Mario')).toEqual([])
    const api = makeApi()
    await importLegacy({ user: { name: 'julia' }, prefs: NO_PREFS, api })
    expect(api.putPref).toHaveBeenCalledWith('hidden_categories', legacyHiddenFor('julia'))
  })

  it('si el servidor ya tiene la lista (aunque vacía) no se recalcula', async () => {
    const api = makeApi()
    await importLegacy({ user: { name: 'Julia' }, prefs: { ...NO_PREFS, hidden_categories: [] }, api })
    expect(api.putPref).not.toHaveBeenCalled()
  })

  it('si falla la subida se reintenta en la siguiente carga', async () => {
    const api = makeApi({ putPref: vi.fn(async () => { throw new Error('API 500') }) })
    const out = await importLegacy({ user: { name: 'Julia' }, prefs: NO_PREFS, api })
    expect(out.failed).toContain('hidden_categories')
  })
})

describe('fusión de categorías por defecto + propias', () => {
  it('suma las propias a las de por defecto', () => {
    const m = mergeCategories({ 'Gasto Variable': [{ concepto: 'Clínica', emoji: '🏥' }] })
    expect(m['Gasto Variable'].map(c => c.concepto)).toEqual([...DEFAULT_CATEGORIES['Gasto Variable'].map(c => c.concepto), 'Clínica'])
    expect(m['Ingreso']).toEqual(DEFAULT_CATEGORIES['Ingreso'])
  })
  it('no duplica una propia que repite una por defecto', () => {
    const m = mergeCategories({ 'Gasto Variable': [{ concepto: 'Ocio', emoji: 'x' }] })
    expect(m['Gasto Variable'].filter(c => c.concepto === 'Ocio')).toHaveLength(1)
  })
  it('oculta por tipo y concepto', () => {
    const m = mergeCategories({}, [{ tipo: 'Gasto Fijo', concepto: 'Cripto' }])
    expect(m['Gasto Fijo'].some(c => c.concepto === 'Cripto')).toBe(false)
    expect(m['Gasto Fijo'].some(c => c.concepto === 'Inversiones')).toBe(true)
  })
})
