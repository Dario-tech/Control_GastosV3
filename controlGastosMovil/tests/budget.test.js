import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
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
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.useRealTimers())
  it('añade, filtra por mes, edita y elimina; persiste en localStorage', () => {
    // addItem usa Date.now() como id: se avanza el reloj para evitar ids repetidos en el mismo ms
    vi.useFakeTimers()
    const { result } = renderHook(() => useBudget())
    act(() => { result.current.addItem({ name: 'Ocio', limit: 50 }, 2) })
    vi.advanceTimersByTime(5)
    act(() => { result.current.addItem({ name: 'Comida', limit: 200 }, 2) })
    vi.advanceTimersByTime(5)
    act(() => { result.current.addItem({ name: 'Otro', limit: 10 }, 3) })
    expect(result.current.itemsForMonth(2)).toHaveLength(2)
    expect(result.current.itemsForMonth(2)[0].color).toBe(BUDGET_COLORS[0])
    expect(result.current.itemsForMonth(2)[1].color).toBe(BUDGET_COLORS[1])
    const id = result.current.itemsForMonth(3)[0].id
    act(() => { result.current.updateItem(id, { limit: 99 }) })
    expect(result.current.itemsForMonth(3)[0].limit).toBe(99)
    act(() => { result.current.removeItem(id) })
    expect(result.current.itemsForMonth(3)).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem('mi-economia-budget-v3'))).toHaveLength(2)
  })
  it('migra v2 a v3 asignando mes y color', () => {
    localStorage.setItem('mi-economia-budget-v2', JSON.stringify([{ id: '1', name: 'X', limit: 5 }]))
    const { result } = renderHook(() => useBudget())
    expect(result.current.allItems[0]).toMatchObject({ month: new Date().getMonth(), color: BUDGET_COLORS[0] })
    expect(localStorage.getItem('mi-economia-budget-v3')).not.toBeNull()
  })
  it('datos corruptos -> lista vacía', () => {
    localStorage.setItem('mi-economia-budget-v3', 'no-json')
    expect(renderHook(() => useBudget()).result.current.allItems).toEqual([])
  })
})
