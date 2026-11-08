import { describe, it, expect } from 'vitest'
import { mergeFixedRecurring, ruleCoversMonth, nextMonthOf } from '../src/utils/fixedRecurring'

const row = (concept, entries) => ({ concept, emoji: 'x', amounts: Array(12).fill(0).map((_, i) => entries[i] || 0) })
const base = () => ({
  income: [], fixedExpenses: [row('Luz', { 0: 60 })], variableExpenses: [row('Ocio', { 4: 20 })],
  activeMonths: Array(12).fill(false).map((_, i) => i === 0 || i === 4),
})
const piso = { id: 1, concepto: 'Piso', importe: 700, dia: 1, desde: '2026-03', hasta: '2026-06' }

describe('fijos que se repiten', () => {
  it('cubre el rango de meses (inclusive) y respeta el año', () => {
    expect([2, 3, 4, 5].every(m => ruleCoversMonth(piso, 2026, m))).toBe(true)
    expect(ruleCoversMonth(piso, 2026, 1)).toBe(false)
    expect(ruleCoversMonth(piso, 2026, 6)).toBe(false)
    expect(ruleCoversMonth(piso, 2027, 3)).toBe(false)
    expect(ruleCoversMonth({ ...piso, hasta: null }, 2030, 0)).toBe(true)      // sin fin
    expect(ruleCoversMonth({ ...piso, hasta: null }, 2026, 1)).toBe(false)     // antes del inicio
  })

  it('proyecta una fila nueva solo en los meses de la regla y activa esos meses', () => {
    const d = mergeFixedRecurring(base(), [piso], 2026)
    const p = d.fixedExpenses.find(i => i.concept === 'Piso')
    expect(p.amounts.map((v, i) => (v ? i : null)).filter(v => v !== null)).toEqual([2, 3, 4, 5])
    expect(p.isProjected).toBe(true)
    expect(d.activeMonths[2] && d.activeMonths[5]).toBe(true)
    expect(d.activeMonths[7]).toBe(false)
  })

  it('un movimiento real de ese mes sustituye al previsto', () => {
    const data = { ...base(), fixedExpenses: [row('Piso', { 3: 705 })] }
    const d = mergeFixedRecurring(data, [piso], 2026)
    const p = d.fixedExpenses.find(i => i.concept === 'Piso')
    expect(p.amounts[3]).toBe(705)                    // el real
    expect(p.amounts[2]).toBe(700)                    // el previsto
    expect(p.isProjected).toBeUndefined()             // fila real: sigue siendo seleccionable
  })

  it('un real en gastos variables de la misma categoría también cuenta como real', () => {
    const data = { ...base(), variableExpenses: [row('Piso', { 2: 650 })] }
    expect(mergeFixedRecurring(data, [piso], 2026).fixedExpenses.find(i => i.concept === 'Piso').amounts[2]).toBe(0)
  })

  it('sin reglas o fuera de rango devuelve los mismos datos', () => {
    const b = base()
    expect(mergeFixedRecurring(b, [], 2026)).toBe(b)
    expect(mergeFixedRecurring(b, [piso], 2030)).toBe(b)
  })

  it('el mes siguiente cruza de año', () => {
    expect(nextMonthOf('2026-03-15')).toBe('2026-04')
    expect(nextMonthOf('2026-12-31')).toBe('2027-01')
  })
})
