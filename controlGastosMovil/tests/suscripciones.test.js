import { describe, it, expect } from 'vitest'
import { buildSubscriptionCalendar, monthlyEquivalent, renewalText } from '../src/utils/subscriptions'

const now = new Date(2025, 4, 10) // 10 may 2025
const rec = (concepto, importe, frecuencia, ultima) => ({ concepto, importe, frecuencia, ultima, ocurrencias: 4, proxima: '' })

describe('suscripciones', () => {
  it('equivalente mensual por frecuencia', () => {
    expect(monthlyEquivalent(12, 'mensual')).toBe(12)
    expect(monthlyEquivalent(120, 'anual')).toBe(10)
    expect(monthlyEquivalent(30, 'trimestral')).toBe(10)
    expect(monthlyEquivalent(10, 'semanal')).toBe(43.33)
    expect(monthlyEquivalent(5, 'rara')).toBe(0)
  })

  it('ordena por próxima renovación, suma y deja fuera ingresos', () => {
    const recurring = [
      rec('Spotify', 10.99, 'mensual', '2025-04-25'),      // próx. 25 may
      rec('Netflix', 12.99, 'mensual', '2025-04-12'),      // próx. 12 may
      rec('Seguro coche', 600, 'anual', '2024-08-01'),     // próx. 1 ago
      rec('Nómina', 1500, 'mensual', '2025-04-28'),        // ingreso: fuera
    ]
    const bucketOf = new Map([['nomina', 'income']])
    const cal = buildSubscriptionCalendar({ recurring, bucketOf, now })
    expect(cal.items.map(i => [i.concepto, i.fecha])).toEqual([
      ['Netflix', '2025-05-12'], ['Spotify', '2025-05-25'], ['Seguro coche', '2025-08-01']])
    expect(cal.items[0].dias).toBe(2)
    expect(cal.totalMensual).toBe(73.98)       // 12.99 + 10.99 + 50
    expect(cal.totalAnual).toBe(887.76)
  })

  it('sin datos', () => {
    expect(buildSubscriptionCalendar({ recurring: [], now })).toEqual({ items: [], totalMensual: 0, totalAnual: 0 })
  })

  it('texto de renovación', () => {
    expect([renewalText(0), renewalText(1), renewalText(5)]).toEqual(['Hoy', 'Mañana', 'En 5 días'])
  })
})

import { splitSubscriptions, groupSubscriptionsAsFixed } from '../src/utils/subscriptions'

describe('suscripciones marcadas', () => {
  const recurring = [
    rec('Netflix', 12.99, 'mensual', '2025-04-12'),
    rec('HBO', 8.99, 'mensual', '2025-04-20'),
    rec('Piso', 700, 'mensual', '2025-04-30'),
  ]
  it('separa marcadas y sugerencias; el calendario solo cuenta las marcadas', () => {
    const r = splitSubscriptions({ recurring, bucketOf: new Map(), keys: ['netflix'], now })
    expect(r.marked.items.map(i => i.key)).toEqual(['netflix'])
    expect(r.marked.totalMensual).toBe(12.99)
    expect(r.suggestions.map(i => i.key).sort()).toEqual(['hbo', 'piso'])
  })
  it('sin marcadas no hay totales', () => {
    expect(splitSubscriptions({ recurring, bucketOf: new Map(), keys: [], now }).marked).toEqual({ items: [], totalMensual: 0, totalAnual: 0 })
  })

  const item = (concept, v) => ({ concept, emoji: 'x', amounts: Array(12).fill(0).map((_, i) => (i < 2 ? v : 0)) })
  const data = { income: [item('Nómina', 1000)], fixedExpenses: [item('Piso', 700), item('Netflix', 13)],
    variableExpenses: [item('HBO', 9), item('Ocio', 50)], activeMonths: [true, true] }

  it('las marcadas pasan a gasto fijo, agrupadas en «Suscripciones»', () => {
    const d = groupSubscriptionsAsFixed(data, ['netflix', 'hbo'])
    expect(d.fixedExpenses.map(i => i.concept)).toEqual(['Piso', 'Suscripciones'])
    expect(d.fixedExpenses[1].amounts[0]).toBe(22)          // 13 + 9
    expect(d.fixedExpenses[1].isSubscriptions).toBe(true)
    expect(d.variableExpenses.map(i => i.concept)).toEqual(['Ocio'])
    // el total de gastos no cambia: solo se reclasifica
    const tot = x => x.fixedExpenses.concat(x.variableExpenses).reduce((s, i) => s + i.amounts[0], 0)
    expect(tot(d)).toBe(tot(data))
  })
  it('sin marcadas o sin coincidencias devuelve los mismos datos', () => {
    expect(groupSubscriptionsAsFixed(data, [])).toBe(data)
    expect(groupSubscriptionsAsFixed(data, ['nada'])).toBe(data)
  })
})
