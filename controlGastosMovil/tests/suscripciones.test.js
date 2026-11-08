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
