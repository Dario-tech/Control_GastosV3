// «¿En qué va el dinero?»: reparto por categorías reales (por defecto y propias).
import { describe, it, expect } from 'vitest'
import { getExpenseBreakdown, categoryColor, OTHERS_COLOR, BREAKDOWN_PALETTE } from '../src/utils/breakdown'

const item = (concept, emoji, total) => ({ concept, emoji, amounts: [total, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] })

describe('getExpenseBreakdown', () => {
  const data = {
    fixedExpenses: [item('Piso', '🏠', 800), item('Luz', '⚡', 60), item('Gimnasio Zen', '🏋️', 40)],
    variableExpenses: [
      item('Comida', '🍽️', 300), item('Ocio', '🎉', 100), item('Mascotas', '🐾', 90),
      item('Ropa', '👗', 50), item('Vuelos', '✈️', 20), item('Variado', '💶', 10),
    ],
  }

  it('ordena por importe, limita a N y agrupa el resto en «Otras»', () => {
    const { items, total } = getExpenseBreakdown(data, 3)
    expect(items.map(i => i.name)).toEqual(['Piso', 'Comida', 'Ocio', 'Otras'])
    expect(items[3].isOther).toBe(true)
    expect(items[3].val).toBe(60 + 40 + 90 + 50 + 20 + 10)
    expect(total).toBe(1470)
  })

  it('la suma de importes coincide con el total de gastos', () => {
    for (const limit of [1, 3, 6, 20]) {
      const { items, total } = getExpenseBreakdown(data, limit)
      expect(items.reduce((s, i) => s + i.val, 0)).toBe(total)
    }
  })

  it('incluye categorías propias con su emoji y sin «Otras» si caben todas', () => {
    const { items } = getExpenseBreakdown(data, 20)
    const own = items.find(i => i.name === 'Mascotas')
    expect(own.emoji).toBe('🐾')
    expect(items.some(i => i.isOther)).toBe(false)
  })

  it('el color es estable por categoría (sin depender del orden) y «Otras» es gris', () => {
    const a = getExpenseBreakdown(data, 20).items.find(i => i.name === 'Mascotas').color
    const reversed = { fixedExpenses: [...data.fixedExpenses].reverse(), variableExpenses: [...data.variableExpenses].reverse() }
    const b = getExpenseBreakdown(reversed, 20).items.find(i => i.name === 'Mascotas').color
    expect(a).toBe(b)
    expect(categoryColor('  MASCOTAS ')).toBe(a)
    expect(BREAKDOWN_PALETTE).toContain(a)
    expect(getExpenseBreakdown(data, 2).items.at(-1).color).toBe(OTHERS_COLOR)
  })

  it('une el mismo concepto en fijos y variables y calcula porcentajes', () => {
    const d = { fixedExpenses: [item('Gimnasio', '💪', 30)], variableExpenses: [item('gimnásio', '💪', 70)] }
    const { items } = getExpenseBreakdown(d)
    expect(items).toHaveLength(1)
    expect(items[0].val).toBe(100)
    expect(items[0].pct).toBe(100)
  })

  it('sin gastos devuelve lista vacía', () => {
    expect(getExpenseBreakdown({ fixedExpenses: [], variableExpenses: [item('Cero', '💶', 0)] })).toEqual({ items: [], total: 0 })
    expect(getExpenseBreakdown(undefined).items).toEqual([])
  })
})
