// Sondeo de pendientes y recargas de finanzas (fake timers, API simulada).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { FinanceDataProvider, useFinanceData } from '../src/context/FinanceDataContext'
import { usePendingTransaction } from '../src/hooks/usePendingTransaction'

let bodyFor = 'viejo'
let sources, visibility, financeCalls, pendingCalls, financeResolvers

class FakeES {
  constructor(url) { this.url = url; this.listeners = {}; this.closed = false; sources.push(this) }
  addEventListener(t, fn) { this.listeners[t] = fn }
  close() { this.closed = true }
  emit() { this.listeners.update?.() }
}
const setVisibility = v => {
  visibility = v
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  document.dispatchEvent(new Event('visibilitychange'))
}
const FIN = { configured: true, year: 2026, activeMonths: [], income: [], fixedExpenses: [], variableExpenses: [], transactions: [] }
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  sources = []; financeCalls = 0; pendingCalls = 0; financeResolvers = null
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.stubGlobal('EventSource', FakeES)
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (String(url).endsWith('/api/finance')) {
      financeCalls++
      if (financeResolvers) return new Promise(res => financeResolvers.push(() => res({ status: 200, ok: true, json: async () => ({ ...FIN, transactions: [{ rowIndex: 1, concepto: bodyFor }] }) })))
      return { status: 200, ok: true, json: async () => FIN }
    }
    if (String(url).endsWith('/api/pending')) { pendingCalls++; return { status: 200, ok: true, json: async () => [] } }
    return { status: 404, ok: false, json: async () => ({}) }
  }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); setVisibility('visible') })

const wrapper = ({ children }) => <FinanceDataProvider>{children}</FinanceDataProvider>

describe('pendientes', () => {
  it('sondea cada 3 minutos, no cada 30 s', async () => {
    renderHook(() => usePendingTransaction())
    await flush()
    expect(pendingCalls).toBe(1)
    await flush(60_000)
    expect(pendingCalls).toBe(1)
    await flush(120_000)
    expect(pendingCalls).toBe(2)
  })

  it('con la pestaña oculta no sondea; al volver refresca una vez', async () => {
    renderHook(() => usePendingTransaction())
    await flush()
    setVisibility('hidden')
    await flush(10 * 60_000)
    expect(pendingCalls).toBe(1)
    setVisibility('visible')
    await flush()
    expect(pendingCalls).toBe(2)
  })

  it('al volver a primer plano respeta un mínimo de 20 s (visibilitychange + pageshow = una)', async () => {
    renderHook(() => usePendingTransaction())
    await flush()
    setVisibility('hidden')
    await flush(5_000)
    setVisibility('visible')
    window.dispatchEvent(new Event('pageshow'))
    await flush()
    expect(pendingCalls).toBe(1)   // hace solo 5 s
    setVisibility('hidden')
    await flush(30_000)
    setVisibility('visible')
    window.dispatchEvent(new Event('pageshow'))
    await flush()
    expect(pendingCalls).toBe(2)
  })
})

describe('finanzas y SSE', () => {
  it('una ráfaga de avisos = una petición de finanzas y una de pendientes', async () => {
    renderHook(() => ({ p: usePendingTransaction() }), { wrapper })
    await flush()
    const f0 = financeCalls, p0 = pendingCalls
    for (let i = 0; i < 5; i++) { sources[0].emit(); await flush(300) }
    expect(financeCalls).toBe(f0)
    await flush(2_000)
    expect(financeCalls).toBe(f0 + 1)
    expect(pendingCalls).toBe(p0 + 1)
  })

  it('si hay una petición en vuelo, encola una sola más', async () => {
    financeResolvers = []
    renderHook(() => 0, { wrapper })
    await flush()
    expect(financeCalls).toBe(1)
    for (let i = 0; i < 3; i++) { sources[0].emit(); await flush(2_100) }
    expect(financeCalls).toBe(1)             // sigue la primera en vuelo
    financeResolvers.shift()()               // termina la primera
    financeResolvers = null
    await flush()
    expect(financeCalls).toBe(2)             // una sola más, no tres
  })

  it('con la app oculta no recarga y cierra el SSE; al volver recarga y reabre', async () => {
    renderHook(() => 0, { wrapper })
    await flush()
    const f0 = financeCalls
    sources[0].emit()
    setVisibility('hidden')
    expect(sources[0].closed).toBe(true)
    await flush(5_000)
    expect(financeCalls).toBe(f0)
    await flush(FINANCE_5MIN())
    expect(financeCalls).toBe(f0)
    setVisibility('visible')
    await flush()
    expect(financeCalls).toBe(f0 + 1)
    expect(sources).toHaveLength(2)
  })

  it('la reconexión del SSE usa backoff exponencial 5 s → 60 s', async () => {
    renderHook(() => 0, { wrapper })
    await flush()
    const waits = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]
    for (let i = 0; i < waits.length; i++) {
      const n = sources.length
      sources.at(-1).onerror()
      await flush(waits[i] - 1)
      expect(sources).toHaveLength(n)
      await flush(1)
      expect(sources).toHaveLength(n + 1)
    }
  })

  it('una respuesta lenta anterior no pisa a una más nueva', async () => {
    financeResolvers = []
    const { result } = renderHook(() => useFinanceData(), { wrapper })
    await flush()
    const slow = financeResolvers.shift()     // petición 1 (vieja), sin responder
    let p2
    act(() => { p2 = result.current.refresh() })   // petición 2 cancela la 1
    await flush()
    bodyFor = 'nuevo'
    financeResolvers.shift()()
    await act(async () => { await p2 })
    expect(result.current.transactions[0].concepto).toBe('nuevo')
    bodyFor = 'viejo'
    slow()
    await flush()
    expect(result.current.transactions[0].concepto).toBe('nuevo')
  })
})

function FINANCE_5MIN() { return 5 * 60_000 }
