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

const tx = (concepto, bucket = 'variableExpenses') => ({ fecha: '2026-10-05', concepto, importe: 10, bucket })

describe('SubscriptionsCard', () => {
  it('se ve SIEMPRE, también sin nada detectado ni marcado, y explica qué es', () => {
    state.toggle = vi.fn()
    render(<SubscriptionsCard transactions={[]} />)
    expect(screen.getByText('🔁 Suscripciones')).toBeTruthy()
    expect(screen.getByText(/Aquí verás tus suscripciones/)).toBeTruthy()
    expect(screen.getByText('Añadir suscripción')).toBeTruthy()
  })

  it('también mientras carga lo detectado', () => {
    state.toggle = vi.fn()
    state.rec = { items: [], status: 'loading' }
    render(<SubscriptionsCard transactions={[]} />)
    expect(screen.getByText('🔁 Suscripciones')).toBeTruthy()
  })

  it('sin detección se puede marcar a mano una categoría que ya usas (no ingresos)', () => {
    state.toggle = vi.fn()
    render(<SubscriptionsCard transactions={[tx('Netflix'), tx('Nómina', 'income')]} />)
    fireEvent.click(screen.getByText('Añadir suscripción'))
    fireEvent.click(screen.getByLabelText('Marcar Netflix como suscripción'))
    expect(state.toggle).toHaveBeenCalledWith('netflix')
    expect(screen.queryByLabelText('Marcar Nómina como suscripción')).toBeNull()
  })

  it('una marcada sin patrón detectado se lista igualmente y se puede quitar', () => {
    state.toggle = vi.fn()
    state.keys = ['netflix']
    render(<SubscriptionsCard transactions={[tx('Netflix')]} />)
    expect(screen.getByText('Aún sin renovación detectada')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Quitar Netflix de suscripciones'))
    expect(state.toggle).toHaveBeenCalledWith('netflix')
  })

  it('lista las detectadas marcadas con total y permite marcar una sugerida', () => {
    state.toggle = vi.fn()
    state.keys = ['netflix']
    state.rec = { status: 'ready', items: [rec('Netflix', 12.99, enDias(-10)), rec('HBO', 8.99, enDias(-5))] }
    render(<SubscriptionsCard transactions={[]} />)
    expect(screen.getByText('Netflix')).toBeTruthy()
    expect(screen.getByText('Al mes')).toBeTruthy()
    expect(screen.queryByText('HBO')).toBeNull()                 // sugerida: dentro de «Añadir»
    fireEvent.click(screen.getByText('Añadir suscripción'))
    fireEvent.click(screen.getByLabelText('Marcar HBO como suscripción'))
    expect(state.toggle).toHaveBeenCalledWith('hbo')
    fireEvent.click(screen.getByLabelText('Quitar Netflix de suscripciones'))
    expect(state.toggle).toHaveBeenCalledWith('netflix')
  })
})
