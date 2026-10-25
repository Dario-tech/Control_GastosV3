// Moneda: fmt() usa la elegida en Ajustes; solo cambia el símbolo, no el valor.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { fmt } from '../src/utils'
import { setCurrency, getCurrency, currencySymbol, normalizeCurrency } from '../src/utils/currency'
import { AmountInput } from '../src/components/ui/FormKit'

const nb = s => s.replace(/ /g, ' ')

afterEach(() => { setCurrency('EUR'); cleanup() })

describe('moneda', () => {
  it('por defecto EUR, con formato español', () => {
    expect(nb(fmt(1234.5, 2))).toBe('1234,50 €')
    expect(nb(fmt(12))).toBe('12 €')
  })
  it('USD y GBP cambian el símbolo sin tocar el número', () => {
    setCurrency('USD')
    expect(nb(fmt(1234.5, 2))).toBe('1234,50 $')
    setCurrency('GBP')
    expect(nb(fmt(1234.5, 2))).toBe('1234,50 £')
    expect(getCurrency()).toBe('GBP')
  })
  it('un valor desconocido vuelve a EUR', () => {
    setCurrency('XYZ')
    expect(getCurrency()).toBe('EUR')
    expect(normalizeCurrency(undefined)).toBe('EUR')
  })
  it('currencySymbol', () => {
    expect(['EUR', 'USD', 'GBP'].map(currencySymbol)).toEqual(['€', '$', '£'])
  })
  it('AmountInput muestra el símbolo de la moneda activa', () => {
    setCurrency('USD')
    const { container } = render(<AmountInput value="5" onChange={() => {}} />)
    expect(container.textContent).toContain('$')
    expect(container.textContent).not.toContain('€')
  })
})
