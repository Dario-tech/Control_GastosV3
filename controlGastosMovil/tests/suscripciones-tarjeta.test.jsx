import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const state = vi.hoisted(() => ({ rec: { items: [], status: 'ready' }, keys: [], toggle: null }))
vi.mock('../src/hooks/useRecurring', () => ({ useRecurring: () => state.rec }))
vi.mock('../src/hooks/useSubscriptionMarks', () => ({ useSubscriptionMarks: () => ({ keys: state.keys, toggle: state.toggle }) }))
vi.mock('../src/hooks/useHideAmounts', () => ({ useHideAmounts: () => false }))

import SubscriptionsCard from '../src/components/ui/SubscriptionsCard'

afterEach(() => { cleanup(); state.rec = { items: [], status: 'ready' }; state.keys = [] })

function enDias(n) {
  const d = new Date(); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const rec = (concepto, importe, ultima) => ({ concepto, importe, frecuencia: 'mensual', ultima, ocurrencias: 4, proxima: '' })

describe('SubscriptionsCard', () => {
  it('no pinta nada sin recurrentes ni cargando', () => {
    state.toggle = vi.fn()
    const { container, rerender } = render(<SubscriptionsCard transactions={[]} />)
    expect(container.innerHTML).toBe('')
    state.rec = { items: [], status: 'loading' }
    rerender(<SubscriptionsCard transactions={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('lista las marcadas con total y permite marcar una sugerida', () => {
    state.toggle = vi.fn()
    state.keys = ['netflix']
    state.rec = { status: 'ready', items: [rec('Netflix', 12.99, enDias(-10)), rec('HBO', 8.99, enDias(-5))] }
    render(<SubscriptionsCard transactions={[]} />)
    expect(screen.getByText('Netflix')).toBeTruthy()
    expect(screen.getByText('Al mes')).toBeTruthy()
    expect(screen.queryByText('HBO')).toBeNull()                 // sugerida: plegada
    fireEvent.click(screen.getByText(/Detectados que se repiten/))
    fireEvent.click(screen.getByLabelText('Marcar HBO como suscripción'))
    expect(state.toggle).toHaveBeenCalledWith('hbo')
    fireEvent.click(screen.getByLabelText('Quitar Netflix de suscripciones'))
    expect(state.toggle).toHaveBeenCalledWith('netflix')
  })

  it('sin marcadas explica qué hacer', () => {
    state.toggle = vi.fn()
    state.rec = { status: 'ready', items: [rec('Netflix', 12.99, enDias(-10))] }
    render(<SubscriptionsCard transactions={[]} />)
    expect(screen.getByText(/Aún no has marcado ninguna/)).toBeTruthy()
  })
})
