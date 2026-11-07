import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const rec = vi.hoisted(() => ({ value: { items: [], status: 'ready' } }))
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ data: { transactions: [] } }) }))
vi.mock('../src/hooks/useRecurring', () => ({ useRecurring: () => rec.value }))
vi.mock('../src/hooks/useHideAmounts', () => ({ useHideAmounts: () => false }))

import SubscriptionsScreen from '../src/components/profile/SubscriptionsScreen'

afterEach(() => { cleanup(); rec.value = { items: [], status: 'ready' } })

function enDias(n) {
  const d = new Date(); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('SubscriptionsScreen', () => {
  it('estado vacío', () => {
    render(<SubscriptionsScreen />)
    expect(screen.getByText(/Aún no he detectado suscripciones/)).toBeTruthy()
  })
  it('lista las suscripciones, la más próxima primero', () => {
    // último cargo hace 25 y 10 días -> próximas en ~5 y ~20 días
    rec.value = { status: 'ready', items: [
      { concepto: 'Spotify', importe: 10, frecuencia: 'mensual', ultima: enDias(-10), proxima: '', ocurrencias: 4 },
      { concepto: 'Netflix', importe: 15, frecuencia: 'mensual', ultima: enDias(-25), proxima: '', ocurrencias: 4 },
    ] }
    render(<SubscriptionsScreen />)
    const nombres = screen.getAllByText(/Spotify|Netflix/).map(e => e.textContent)
    expect(nombres).toEqual(['Netflix', 'Spotify'])
    expect(screen.getByText('Al mes')).toBeTruthy()
  })
  it('error de carga', () => {
    rec.value = { items: [], status: 'error' }
    render(<SubscriptionsScreen />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
