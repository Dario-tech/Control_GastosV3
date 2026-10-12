// Regresión del refactor d6edf0b: los modales divididos se renderizan sin ReferenceError.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import GoalDetailModal from '../src/components/ui/goals/GoalDetailModal'
import GoalFormModal from '../src/components/ui/goals/GoalFormModal'
import { GoalRing, GoalIcon } from '../src/components/ui/goals/GoalRing'
import ExpenseFormModal from '../src/components/ui/annual/ExpenseFormModal'
import BudgetItem from '../src/components/ui/budget/BudgetItem'
import TotalHero from '../src/components/ui/budget/TotalHero'

const goal = {
  id: 1, nombre: 'Viaje', emoji: '✈️', objetivo: 1000, ahorrado: 250,
  fecha: null, created_by: 'a@a.com', members: ['a@a.com'], contributions: [],
}
const noop = () => {}

describe('modales y subcomponentes refactorizados', () => {
  it('GoalDetailModal renderiza (incluye PrimaryButton)', () => {
    render(<GoalDetailModal goal={goal} myEmail="a@a.com" onClose={noop} onAddMoney={vi.fn()}
      onShare={noop} onEdit={noop} onDelete={noop} onDeleteContribution={noop} />)
    expect(screen.getAllByText('Viaje').length).toBeGreaterThan(0)
  })

  it('GoalDetailModal con aportaciones, fecha y meta compartida', () => {
    const g = { ...goal, fecha: '2099-01-01', members: ['a@a.com', 'b@b.com'],
      contributions: [{ id: 9, importe: 50, fecha: '2026-01-02', foto: 'data:image/jpeg;base64,xx', email: 'b@b.com' }] }
    render(<GoalDetailModal goal={g} myEmail="b@b.com" onClose={noop} onAddMoney={noop}
      onShare={noop} onEdit={noop} onDelete={noop} onDeleteContribution={noop} />)
  })

  it('GoalFormModal renderiza nuevo y edición', () => {
    render(<GoalFormModal onSave={noop} onClose={noop} />)
    render(<GoalFormModal goal={goal} onSave={noop} onClose={noop} />)
  })

  it('GoalRing y GoalIcon', () => {
    render(<GoalRing pct={40} done={false}>x</GoalRing>)
    render(<GoalIcon goal={goal} />)
    render(<GoalIcon goal={{ ...goal, imagen_url: 'http://x/y.jpg' }} />)
  })

  it('ExpenseFormModal renderiza nuevo y edición', () => {
    render(<ExpenseFormModal onSave={noop} onClose={noop} />)
    render(<ExpenseFormModal expense={{
      id: 1, nombre: 'IBI', importe: 600, proximo_vencimiento: '2099-05-01', dias_aviso: 7,
      aviso_activo: true, meses_reparto: [1, 2], reparto_mensual: 300, dias_restantes: 100,
    }} onSave={noop} onClose={noop} />)
  })

  it('BudgetItem y TotalHero', () => {
    render(<BudgetItem item={{ name: 'Ocio', emoji: '🎮', limit: 100 }} spent={120} threshold={80} onEdit={noop} />)
    render(<TotalHero totalLimit={500} totalSpent={100} daysLeft={10} threshold={80} />)
    expect(screen.getByText('Total mensual')).toBeTruthy()
  })
})
