// Cierre: importes ocultos en formularios, etiquetas rápidas con la moneda activa y motivo visible del botón Ocultar.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setCurrency } from '../src/utils/currency'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

let hide = true
vi.mock('../src/context/SettingsContext', () => ({
  useSettings: () => ({
    customCategories: {}, settings: { hideAmounts: hide, theme: 'dark' },
    hiddenCategories: [], setHiddenCategories: () => {},
  }),
}))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ data: {}, transactions: [], refresh: () => {} }) }))

import BudgetModal from '../src/components/ui/BudgetModal'
import ExpenseFormModal from '../src/components/ui/annual/ExpenseFormModal'
import GoalFormModal from '../src/components/ui/goals/GoalFormModal'

afterEach(() => { cleanup(); setCurrency('EUR'); hide = true })

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')

describe('A) importes en formularios', () => {
  it('el CSS difumina el input de importe sin foco y la vista previa', () => {
    expect(css).toMatch(/\.hide-amounts \.fm-amount:not\(:focus-within\) \.fm-amount-input/)
    expect(css).toMatch(/\.hide-amounts \.fm-preview-amount/)
  })
  it('la vista previa del presupuesto envuelve las cifras en .amt', () => {
    const { container } = render(<BudgetModal item={{ id: 1, name: 'Comida', emoji: '🍽️', limit: 150, type: 'Gasto Variable' }} onSave={() => {}} onClose={() => {}} />)
    expect(container.querySelectorAll('.amt').length).toBeGreaterThan(0)
  })
  it('la vista previa de la meta envuelve las cifras en .amt', () => {
    const { container } = render(<GoalFormModal goal={{ nombre: 'Viaje', objetivo: 5000.5, ahorrado: 100, emoji: '🎯' }} onSave={() => {}} onClose={() => {}} />)
    expect(container.querySelectorAll('.amt').length).toBeGreaterThan(0)
  })
})

describe('B) moneda en cantidades rápidas', () => {
  it.each([
    ['BudgetModal', () => <BudgetModal onSave={() => {}} onClose={() => {}} />],
    ['ExpenseFormModal', () => <ExpenseFormModal onSave={() => {}} onClose={() => {}} />],
    ['GoalFormModal', () => <GoalFormModal onSave={() => {}} onClose={() => {}} />],
  ])('%s usa la moneda activa al abrirse', (_n, make) => {
    setCurrency('USD')
    const { container } = render(make())
    const chips = [...container.querySelectorAll('.fm-chip, .fm-chips button')].map(b => b.textContent)
    expect(chips.some(t => t.includes('$'))).toBe(true)
    expect(chips.some(t => t.includes('€'))).toBe(false)
  })
})

