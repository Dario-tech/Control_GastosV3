// SettingsProvider: la moneda llega a fmt() y las categorías ocultas se guardan en el servidor.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider } from '../src/context/AuthContext'
import { SettingsProvider, useSettings } from '../src/context/SettingsContext'
import { useCategories } from '../src/hooks/useCategories'
import { fmt } from '../src/utils'
import { setCurrency } from '../src/utils/currency'
import { AUTH_KEY } from '../src/utils/storageKeys'

const nb = s => s.replace(/ /g, ' ')

function makeServer(prefs = {}) {
  const s = { prefs: { settings: null, budgets: null, hidden_categories: null, tour: null, ...prefs }, puts: [] }
  s.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    const method = opts.method || 'GET'
    const res = (status, body = {}) => ({ status, ok: status < 400, json: async () => body })
    if (path === '/api/prefs' && method === 'GET') return res(200, { ...s.prefs, updated_at: {} })
    const m = path.match(/^\/api\/prefs\/(\w+)$/)
    if (m && method === 'PUT') { const b = JSON.parse(opts.body); s.prefs[m[1]] = b.data; s.puts.push([m[1], b.data]); return res(200, {}) }
    if (path === '/api/categories') return res(200, { categories: [] })
    return res(404)
  })
  return s
}
const wrapper = ({ children }) => <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
const both = () => ({ s: useSettings(), cats: useCategories() })

describe('moneda y categorías ocultas con servidor', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem(AUTH_KEY, JSON.stringify({ email: 'm@m.es', name: 'M', sessionToken: 't' })) })
  afterEach(() => { vi.unstubAllGlobals(); setCurrency('EUR') })

  it('la moneda guardada en el servidor se aplica a fmt() y al cambiarla', async () => {
    const server = makeServer({ settings: { currency: 'GBP' } })
    vi.stubGlobal('fetch', server.fetch)
    const { result } = renderHook(both, { wrapper })
    await waitFor(() => expect(result.current.s.settings.currency).toBe('GBP'))
    expect(nb(fmt(5))).toBe('5 £')
    act(() => result.current.s.update('currency', 'USD'))
    expect(nb(fmt(5))).toBe('5 $')
    await waitFor(() => expect(server.puts.some(([k, d]) => k === 'settings' && d.currency === 'USD')).toBe(true))
  })

  it('ocultar categorías: se guarda en el servidor y useCategories las filtra', async () => {
    const server = makeServer()
    vi.stubGlobal('fetch', server.fetch)
    const { result } = renderHook(both, { wrapper })
    await waitFor(() => expect(result.current.s.prefsLoaded).toBe(true))
    act(() => result.current.s.setHiddenCategories([{ tipo: 'Gasto Variable', concepto: 'Ocio' }]))
    expect(result.current.cats['Gasto Variable'].some(c => c.concepto === 'Ocio')).toBe(false)
    expect(result.current.cats['Gasto Fijo'].some(c => c.concepto === 'Luz')).toBe(true)
    await waitFor(() => expect(server.puts.some(([k, d]) => k === 'hidden_categories' && d.length === 1)).toBe(true))
    act(() => result.current.s.setHiddenCategories([]))
    expect(result.current.cats['Gasto Variable'].some(c => c.concepto === 'Ocio')).toBe(true)
  })
})
