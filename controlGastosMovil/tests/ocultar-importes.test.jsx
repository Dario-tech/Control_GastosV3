// «Ocultar importes»: máscara en recharts, clase en el contenedor y CSS que cubre todas las cifras.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fmtAmount, maskAmount, axisTick, AMOUNT_MASK } from '../src/utils/amounts'

let hide = true
vi.mock('../src/context/SettingsContext', () => ({
  useSettings: () => ({ settings: { hideAmounts: hide, theme: 'dark' } }),
}))

import Amt from '../src/components/ui/Amt'
import { useHideAmounts } from '../src/hooks/useHideAmounts'

afterEach(() => { cleanup(); hide = true })

describe('formateadores con máscara', () => {
  it('devuelven ••• cuando está activo y la cifra cuando no', () => {
    expect(fmtAmount(1234, true)).toBe(AMOUNT_MASK)
    expect(fmtAmount(1234, false)).toMatch(/1\.?234/)
    expect(maskAmount('12 €', true)).toBe('•••')
    expect(maskAmount('12 €', false)).toBe('12 €')
  })
  it('el eje Y queda vacío al ocultar', () => {
    expect(axisTick(true)(5000)).toBe('')
    expect(axisTick(false)(5000)).toBe('5k')
    expect(axisTick(false)(500)).toBe(500)
  })
})

describe('useHideAmounts / Amt', () => {
  it('lee el ajuste', () => {
    function Probe() { return <span>{String(useHideAmounts())}</span> }
    render(<Probe />)
    expect(screen.getByText('true')).toBeTruthy()
    cleanup(); hide = false
    render(<Probe />)
    expect(screen.getByText('false')).toBeTruthy()
  })
  it('Amt marca la cifra con la clase que difumina el CSS', () => {
    render(<Amt>1.200 €</Amt>)
    expect(screen.getByText('1.200 €').className).toBe('amt')
  })
})

describe('CSS', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')
  it.each([
    '.amt', '.annual-item-amount', '.bgt-hero-remaining', '.recur-amount',
    '.top-amount', '.breakdown-amount', '.donut-value', '.legend-amount', '.mt-cell.positive',
    '.txlog-importe', '.search-importe', '.cv-row-amt', '.hero-balance-value', '.concept-amount',
  ])('difumina %s', sel => {
    const block = css.split('{').filter(b => b.includes('.hide-amounts'))
      .join('{')
    expect(block).toContain(sel)
  })
})

describe('contenedor', () => {
  it('App.jsx aplica hide-amounts a .app y a <html>', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
    expect(src).toMatch(/settings\.hideAmounts \? ' hide-amounts'/)
    expect(src).toMatch(/documentElement\.classList\.toggle\('hide-amounts'/)
  })
})
