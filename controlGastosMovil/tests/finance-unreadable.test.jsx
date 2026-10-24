// Aviso de movimientos ilegibles: GET /api/finance trae `unreadable: <int>`
// (un backend antiguo no lo manda). Es estado del servidor: no va a la caché.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { FinanceDataProvider, useFinanceData, unreadableTxMsg, splitUnreadable } from '../src/context/FinanceDataContext'
import { FINANCE_CACHE_KEY } from '../src/utils/storageKeys'

class FakeEventSource {
  constructor() { this.listeners = {} }
  addEventListener(t, fn) { this.listeners[t] = fn }
  close() {}
}

const FINANCE = {
  configured: true, year: 2026, activeMonths: Array(12).fill(false),
  income: [], fixedExpenses: [], variableExpenses: [],
  transactions: [{ rowIndex: 1, fecha: '2026-10-01', importe: 10, concepto: 'Ocio' }],
}

let nextBody
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('EventSource', FakeEventSource)
  nextBody = FINANCE
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => nextBody })))
})
afterEach(() => vi.unstubAllGlobals())

const wrapper = ({ children }) => <FinanceDataProvider>{children}</FinanceDataProvider>
const cached = () => JSON.parse(localStorage.getItem(FINANCE_CACHE_KEY))

describe('unreadableTxMsg', () => {
  it('sin ilegibles (0, ausente o basura) no hay aviso', () => {
    for (const v of [0, undefined, null, '', 'abc', -3, NaN, 0.4]) expect(unreadableTxMsg(v)).toBeNull()
  })

  it('singular con 1', () => {
    expect(unreadableTxMsg(1)).toBe('No se ha podido leer 1 movimiento del servidor. Los totales pueden estar incompletos.')
  })

  it('plural con más de 1 (y redondea hacia abajo)', () => {
    expect(unreadableTxMsg(2)).toBe('No se han podido leer 2 movimientos del servidor. Los totales pueden estar incompletos.')
    expect(unreadableTxMsg('7')).toMatch(/^No se han podido leer 7 movimientos/)
    expect(unreadableTxMsg(2.9)).toMatch(/leer 2 movimientos/)
  })
})

describe('splitUnreadable', () => {
  it('separa el recuento y deja el resto intacto', () => {
    const { data, unreadable } = splitUnreadable({ ...FINANCE, unreadable: 3 })
    expect(unreadable).toBe(3)
    expect(data).toEqual(FINANCE)
    expect('unreadable' in data).toBe(false)
  })

  it('backend sin el campo, o valores raros, cuentan como 0', () => {
    expect(splitUnreadable(FINANCE).unreadable).toBe(0)
    expect(splitUnreadable({ unreadable: 'x' }).unreadable).toBe(0)
    expect(splitUnreadable({ unreadable: -1 }).unreadable).toBe(0)
    expect(splitUnreadable(null)).toEqual({ data: {}, unreadable: 0 })
  })
})

describe('FinanceDataProvider con ilegibles', () => {
  it('expone unreadableTx y no lo guarda en la caché', async () => {
    nextBody = { ...FINANCE, unreadable: 3 }
    const { result } = renderHook(() => useFinanceData(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(result.current.unreadableTx).toBe(3)
    expect(unreadableTxMsg(result.current.unreadableTx)).toMatch(/3 movimientos/)
    expect(result.current.data.unreadable).toBeUndefined()
    expect(cached().transactions).toHaveLength(1)
    expect('unreadable' in cached()).toBe(false)
  })

  it('un backend antiguo sin el campo da 0 (sin aviso)', async () => {
    const { result } = renderHook(() => useFinanceData(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(result.current.unreadableTx).toBe(0)
    expect(unreadableTxMsg(result.current.unreadableTx)).toBeNull()
  })

  it('el aviso desaparece cuando el servidor ya lo lee todo', async () => {
    nextBody = { ...FINANCE, unreadable: 1 }
    const { result } = renderHook(() => useFinanceData(), { wrapper })
    await waitFor(() => expect(result.current.unreadableTx).toBe(1))
    nextBody = { ...FINANCE, unreadable: 0 }
    await act(async () => { await result.current.refresh() })
    expect(result.current.unreadableTx).toBe(0)
  })

  it('una caché antigua que traía el campo no lo resucita al arrancar sin red', async () => {
    localStorage.setItem(FINANCE_CACHE_KEY, JSON.stringify({ ...FINANCE, unreadable: 5 }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useFinanceData(), { wrapper })
    expect(result.current.data.unreadable).toBeUndefined()
    await waitFor(() => expect(result.current.status).toBe('offline'))
    expect(result.current.unreadableTx).toBe(0)
    expect(result.current.transactions).toHaveLength(1)
  })
})
