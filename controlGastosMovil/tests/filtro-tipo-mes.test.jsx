// Filtro Todo | Gastos fijos | Gastos variables de la pestaña Mes.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { groupConceptsForMonth } from '../src/utils/conceptBreakdown'
import { txVisible } from '../src/components/ui/CalendarView'

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }

const item = (concept, v, m = 9) => ({ concept, emoji: '💶', amounts: Array.from({ length: 12 }, (_, i) => (i === m ? v : 0)) })
let finance
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ data: finance, transactions: [] }) }))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ selectedMonth: 9, selectedYear: 2026, setSelectedMonth() {}, setSelectedYear() {} }) }))
vi.mock('../src/hooks/useAnnualExpenses', () => ({ useAnnualExpenses: () => ({ expenses: [] }) }))
vi.mock('../src/hooks/useHideAmounts', () => ({ useHideAmounts: () => false }))

import MonthTab from '../src/components/tabs/MonthTab'

afterEach(cleanup)

describe('groupConceptsForMonth', () => {
  it('top 5 + Otros', () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map(n => item('c' + n, n * 10))
    const r = groupConceptsForMonth(items, 9)
    expect(r).toHaveLength(6)
    expect(r[0].name).toBe('c7')
    expect(r[5]).toMatchObject({ name: 'Otros', value: 30, isOther: true })
  })
  it('vacío y un solo concepto', () => {
    expect(groupConceptsForMonth([], 9)).toEqual([])
    expect(groupConceptsForMonth([item('a', 0)], 9)).toEqual([])
    expect(groupConceptsForMonth([item('a', 5), item('b', 3, 2)], 9)).toHaveLength(1)
  })
})

describe('txVisible', () => {
  it('filtra por bucket', () => {
    expect(txVisible({ bucket: 'income' }, 'todo')).toBe(true)
    expect(txVisible({ bucket: 'income' }, 'fijo')).toBe(false)
    expect(txVisible({ bucket: 'fixedExpenses' }, 'fijo')).toBe(true)
    expect(txVisible({ bucket: 'fixedExpenses' }, 'variable')).toBe(false)
    expect(txVisible({ bucket: 'variableExpenses' }, 'variable')).toBe(true)
  })
})

describe('MonthTab filtro de tipo', () => {
  it('cambia título y reparto', () => {
    finance = {
      activeMonths: Array(12).fill(true), transactions: [],
      income: [item('Nómina', 2000)],
      fixedExpenses: [item('Alquiler', 700)],
      variableExpenses: [item('Comida', 200)],
    }
    render(<MonthTab />)
    expect(screen.getByText('Distribución de gastos')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Todo' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Gastos fijos' }))
    expect(screen.getByText('Gastos fijos por concepto')).toBeTruthy()
    expect(document.querySelector(".legend-name").textContent).toContain("Alquiler")
    fireEvent.click(screen.getByRole('button', { name: 'Gastos variables' }))
    expect(screen.getByText('Gastos variables por concepto')).toBeTruthy()
  })
})
