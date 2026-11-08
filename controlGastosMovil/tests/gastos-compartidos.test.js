import { describe, it, expect } from 'vitest'
import { parseAmountInput, equalSplit, splitDifference, debtText } from '../src/utils/groups'

describe('gastos compartidos (utilidades)', () => {
  it('parsea importes en formato español', () => {
    expect(parseAmountInput('12,5')).toBe(12.5)
    expect(parseAmountInput('1.234,56 €')).toBe(1234.56)
    expect(parseAmountInput('7.25')).toBe(7.25)
    for (const mal of ['', 'abc', '0', '-3', '1,234', '12,345', null]) expect(parseAmountInput(mal)).toBeNull()
  })
  it('reparto igual como el servidor: el resto, por orden de email', () => {
    expect(equalSplit(10, ['c@x', 'a@x', 'b@x'])).toEqual({ 'a@x': 3.34, 'b@x': 3.33, 'c@x': 3.33 })
    expect(equalSplit(0, ['a@x'])).toEqual({})
  })
  it('diferencia entre total y partes', () => {
    expect(splitDifference(10, { a: 4, b: 5 })).toBe(1)
    expect(splitDifference(10, { a: 4, b: 6 })).toBe(0)
    expect(splitDifference(10, { a: 7, b: 6 })).toBe(-3)
  })
  it('frase de deuda', () => {
    expect(debtText({ de: 'b', a: 'a', importe: 30 }, e => ({ a: 'Ana', b: 'Beto' }[e]), n => `${n} €`)).toBe('Beto debe 30 € a Ana')
  })
})
