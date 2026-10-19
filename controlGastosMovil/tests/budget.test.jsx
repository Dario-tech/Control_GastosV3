import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider } from '../src/context/AuthContext'
import { SettingsProvider } from '../src/context/SettingsContext'
import { statusOf, budgetProgress, daysLeftInMonth } from '../src/utils/budget'
import { useBudget, BUDGET_COLORS } from '../src/hooks/useBudget'
import { createNotifCache } from '../src/utils/notifCache'

describe('utils/budget', () => {
  it('statusOf', () => {
    expect(statusOf(50, 100, 80)).toBe('ok')
    expect(statusOf(80, 100, 80)).toBe('warn')
    expect(statusOf(100, 100, 80)).toBe('warn')
    expect(statusOf(101, 100, 80)).toBe('over')
    expect(statusOf(50, 0, 80)).toBe('ok')
  })
  it('budgetProgress', () => {
    expect(budgetProgress(150, 100, 80)).toMatchObject({ rawPct: 150, pct: 100, remaining: -50, over: true, st: 'over' })
    expect(budgetProgress(10, 0, 80)).toMatchObject({ rawPct: 0, pct: 0, remaining: -10, st: 'ok' })
  })
  describe('daysLeftInMonth', () => {
    afterEach(() => vi.useRealTimers())
    it('días restantes del mes en curso y 0 en otro mes', () => {
      vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 1, 10)) // 10 feb 2026 (28 días)
      expect(daysLeftInMonth(1)).toBe(18)
      expect(daysLeftInMonth(5)).toBe(0)
    })
  })
})

describe('notifCache', () => {
  beforeEach(() => localStorage.clear())
  it('guarda y lee; tolera JSON corrupto', () => {
    const c = createNotifCache('k')
    expect(c.get()).toEqual({})
    c.set({ a: 1 })
    expect(c.get()).toEqual({ a: 1 })
    localStorage.setItem('k', '{mal')
    expect(c.get()).toEqual({})
  })
})

describe('useBudget', () => {
  let putBodies
  beforeEach(() => {
    localStorage.clear()
    // Los datos antiguos solo se muestran a su dueño: hay un usuario con sesión
    localStorage.setItem('mi-economia-auth-v1', JSON.stringify({ email: 'm@m.es', name: 'Mario', sessionToken: 't' }))
    putBodies = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      if (opts.method === 'PUT') { putBodies.push(JSON.parse(opts.body).data); return { status: 200, ok: true, json: async () => ({ updated_at: 'x' }) } }
      return { status: 404, ok: false, json: async () => ({}) }
    }))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  const wrapper = ({ children }) => <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
  const hook = () => renderHook(() => useBudget(), { wrapper })

  it('añade, filtra por mes, edita y elimina; cada cambio se guarda en el servidor', async () => {
    const { result } = hook()
    act(() => { result.current.addItem({ name: 'Ocio', limit: 50 }, 2) })
    act(() => { result.current.addItem({ name: 'Comida', limit: 200 }, 2) })
    act(() => { result.current.addItem({ name: 'Otro', limit: 10 }, 3) })
    expect(result.current.itemsForMonth(2)).toHaveLength(2)
    expect(result.current.itemsForMonth(2)[0].color).toBe(BUDGET_COLORS[0])
    expect(result.current.itemsForMonth(2)[1].color).toBe(BUDGET_COLORS[1])
    const id = result.current.itemsForMonth(3)[0].id
    act(() => { result.current.updateItem(id, { limit: 99 }) })
    expect(result.current.itemsForMonth(3)[0].limit).toBe(99)
    act(() => { result.current.removeItem(id) })
    expect(result.current.itemsForMonth(3)).toHaveLength(0)
    await waitFor(() => expect(putBodies.at(-1)?.items).toHaveLength(2))
    expect(putBodies.at(-1).version).toBe(3)
    // la clave antigua NO se vuelve a escribir: es solo de importación
    expect(localStorage.getItem('mi-economia-budget-v3')).toBeNull()
  })
  it('dos altas en el mismo instante tienen ids distintos y borrar una no borra la otra', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 1, 10)) // reloj congelado: mismo ms
    const { result } = hook()
    act(() => {
      result.current.addItem({ name: 'A', limit: 1 }, 2)
      result.current.addItem({ name: 'B', limit: 2 }, 2)
    })
    const [a, b] = result.current.itemsForMonth(2)
    expect(a.id).not.toBe(b.id)
    act(() => { result.current.updateItem(a.id, { limit: 77 }) })
    expect(result.current.itemsForMonth(2).find(i => i.id === b.id).limit).toBe(2)
    act(() => { result.current.removeItem(a.id) })
    expect(result.current.itemsForMonth(2)).toHaveLength(1)
    expect(result.current.itemsForMonth(2)[0].id).toBe(b.id)
  })
  it('conserva ids antiguos (Date.now) y sigue operando sobre ellos', () => {
    localStorage.setItem('mi-economia-budget-v3', JSON.stringify([{ id: '1700000000000', name: 'Old', limit: 5, month: 2, color: '#fff' }]))
    const { result } = hook()
    act(() => { result.current.addItem({ name: 'New', limit: 6 }, 2) })
    expect(result.current.itemsForMonth(2).map(i => i.id)[0]).toBe('1700000000000')
    act(() => { result.current.removeItem('1700000000000') })
    expect(result.current.itemsForMonth(2)).toHaveLength(1)
    expect(result.current.itemsForMonth(2)[0].name).toBe('New')
  })
  it('pinta la clave v2 antigua migrada en memoria (mes y color) sin tocar la clave', () => {
    localStorage.setItem('mi-economia-budget-v2', JSON.stringify([{ id: '1', name: 'X', limit: 5 }]))
    const { result } = hook()
    expect(result.current.allItems[0]).toMatchObject({ month: new Date().getMonth(), color: BUDGET_COLORS[0] })
    expect(localStorage.getItem('mi-economia-budget-v2')).not.toBeNull()
  })
  it('datos corruptos -> lista vacía', () => {
    localStorage.setItem('mi-economia-budget-v3', 'no-json')
    expect(hook().result.current.allItems).toEqual([])
  })
})
