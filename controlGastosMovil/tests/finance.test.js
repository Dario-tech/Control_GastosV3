import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fmt, sumMonth, sumAll, mergeAnnualSplits, getActiveMonths, getMonthStats, getYearStats,
  getCumulativeBalance, getMonthlyReport, getBalanceForecast, isUnusualAmount, getTopExpenses,
  getTransactionYears, filterDataByYear,
} from '../src/utils'

const row = (concept, first, second = 0) => {
  const amounts = Array(12).fill(0); amounts[0] = first; amounts[1] = second
  return { concept, emoji: 'x', amounts }
}
const base = () => ({
  year: 2026,
  activeMonths: [true, true, ...Array(10).fill(false)],
  income: [row('Nómina', 2000, 2000)],
  fixedExpenses: [row('Alquiler', 800, 800)],
  variableExpenses: [row('Comida', 200, 400)],
})

afterEach(() => vi.useRealTimers())

describe('sumas y estadísticas', () => {
  it('sumMonth / sumAll', () => {
    const d = base()
    expect(sumMonth(d.income, 0)).toBe(2000)
    expect(sumAll(d.fixedExpenses)).toBe(1600)
  })
  it('getMonthStats', () => {
    expect(getMonthStats(base(), 1)).toEqual({ income: 2000, fixed: 800, variable: 400, expenses: 1200, balance: 800, savingsRate: 40 })
  })
  it('savingsRate 0 sin ingresos', () => {
    const d = { ...base(), income: [] }
    expect(getMonthStats(d, 0).savingsRate).toBe(0)
  })
  it('getYearStats y medias por mes activo', () => {
    const s = getYearStats(base())
    expect(s).toMatchObject({ income: 4000, expenses: 2200, balance: 1800, avgIncome: 2000, avgExpenses: 1100 })
  })
  it('getActiveMonths y balance acumulado', () => {
    expect(getActiveMonths(base()).map(m => m.index)).toEqual([0, 1])
    expect(getCumulativeBalance(base())).toEqual([{ month: 0, cumulative: 1000 }, { month: 1, cumulative: 1800 }])
  })
  it('getTopExpenses ordena y limita', () => {
    const top = getTopExpenses(base(), 2)
    expect(top.map(t => t.name)).toEqual(['Alquiler', 'Comida'])
  })
  it('fmt formatea en euros', () => {
    expect(fmt(1234)).toContain('1234')
    expect(fmt(1234)).toContain('€')
  })
})

describe('mergeAnnualSplits', () => {
  it('sin gastos anuales devuelve los mismos datos', () => {
    const d = base()
    expect(mergeAnnualSplits(d, [])).toBe(d)
    expect(mergeAnnualSplits(d, [{ nombre: 'IBI', meses_reparto: [] }])).toBe(d)
  })
  it('añade un gasto fijo sintético y activa los meses del reparto', () => {
    const d = base()
    const out = mergeAnnualSplits(d, [{ nombre: 'IBI', meses_reparto: [3, 4], reparto_mensual: 50 }])
    const syn = out.fixedExpenses.at(-1)
    expect(syn).toMatchObject({ concept: 'IBI · reparto', isAnnualSplit: true })
    expect(syn.amounts[2]).toBe(50)
    expect(syn.amounts[3]).toBe(50)
    expect(out.activeMonths[2]).toBe(true)
    expect(out.activeMonths[3]).toBe(true)
    expect(d.fixedExpenses).toHaveLength(1) // no muta
    expect(getMonthStats(out, 2).fixed).toBe(50)
  })
})

describe('getMonthlyReport', () => {
  it('null si no hay mes anterior', () => {
    expect(getMonthlyReport(base(), 0)).toBeNull()
  })
  it('compara con el mes anterior y lista los movimientos', () => {
    const r = getMonthlyReport(base(), 1)
    expect(r.prevMonth).toBe(0)
    expect(r.expDelta).toBe(200)
    expect(r.expPct).toBe(20)
    expect(r.savingsDelta).toBe(-200)
    expect(r.movers).toEqual([{ name: 'Comida', emoji: 'x', delta: 200 }])
  })
})

describe('getBalanceForecast', () => {
  it('null fuera del mes actual o el día 1', () => {
    expect(getBalanceForecast(base(), 0, new Date(2026, 3, 10))).toBeNull()
    expect(getBalanceForecast(base(), 1, new Date(2026, 1, 1))).toBeNull()
  })
  it('extrapola el gasto variable y fija la confianza', () => {
    const now = new Date(2026, 1, 14) // 14 feb, 28 días
    const f = getBalanceForecast(base(), 1, now)
    expect(f.daysInMonth).toBe(28)
    expect(f.projectedVariable).toBeCloseTo((400 / 14) * 28)
    expect(f.projectedFixed).toBe(800)
    expect(f.projectedIncome).toBe(2000)
    expect(f.confidence).toBe('high')
    expect(getBalanceForecast(base(), 1, new Date(2026, 1, 6)).confidence).toBe('medium')
    expect(getBalanceForecast(base(), 1, new Date(2026, 1, 3)).confidence).toBe('low')
  })
})

describe('isUnusualAmount', () => {
  const data = { transactions: [1, 2, 3].map(() => ({ concepto: 'Cafe', importe: 10 })) }
  it('null con poco historial', () => {
    expect(isUnusualAmount({ transactions: [{ concepto: 'Cafe', importe: 10 }] }, 'Cafe', 100)).toBeNull()
  })
  it('detecta importes >= factor x media', () => {
    expect(isUnusualAmount(data, 'Cafe', 19)).toBeNull()
    expect(isUnusualAmount(data, 'Cafe', 25)).toEqual({ avg: 10, ratio: 2.5 })
  })
})

describe('años de transacciones', () => {
  const tx = (fecha, month, bucket, concepto, importe) => ({ fecha, month, bucket, concepto, importe })
  const data = {
    ...base(),
    transactions: [
      tx('2025-12-01', 11, 'variableExpenses', 'Comida', 50),
      tx('2026-01-05', 0, 'variableExpenses', 'Comida', 30),
      tx('2026-01-06', 0, 'income', 'Nómina', 100),
    ],
  }
  it('getTransactionYears', () => {
    expect(getTransactionYears(data)).toEqual([2025, 2026])
    expect(getTransactionYears({})).toEqual([])
  })
  it('filterDataByYear reconstruye desde transacciones', () => {
    const out = filterDataByYear(data, 2026)
    expect(out.year).toBe(2026)
    expect(out.activeMonths[0]).toBe(true)
    expect(out.activeMonths[11]).toBe(false)
    expect(out.variableExpenses[0]).toMatchObject({ concept: 'Comida', emoji: 'x' })
    expect(out.variableExpenses[0].amounts[0]).toBe(30)
    expect(out.income[0].amounts[0]).toBe(100)
  })
  it('un único año coincidente devuelve los datos tal cual', () => {
    const d = { ...base(), transactions: [tx('2026-01-05', 0, 'income', 'Nómina', 1)] }
    expect(filterDataByYear(d, 2026)).toBe(d)
  })
})
