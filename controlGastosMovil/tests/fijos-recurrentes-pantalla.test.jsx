import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const st = vi.hoisted(() => ({ rules: [], editRule: vi.fn(), removeRule: vi.fn() }))
vi.mock('../src/hooks/useFixedRecurring', () => ({ useFixedRecurring: () => ({ rules: st.rules, status: 'ready', editRule: st.editRule, removeRule: st.removeRule }) }))
vi.mock('../src/hooks/useHideAmounts', () => ({ useHideAmounts: () => false }))

import FixedRecurring from '../src/components/ui/FixedRecurring'

afterEach(() => { cleanup(); vi.clearAllMocks(); st.rules = [] })

describe('FixedRecurring', () => {
  it('sin reglas explica cómo crearlas', () => {
    render(<FixedRecurring />)
    expect(screen.getByText(/Repetir cada mes/)).toBeTruthy()
  })
  it('muestra hasta cuándo dura y permite cambiar la fecha de fin', async () => {
    st.rules = [{ id: 3, concepto: 'Piso', importe: 700, dia: 1, desde: '2026-12', hasta: '2027-12' }]
    st.editRule.mockResolvedValue()
    render(<FixedRecurring />)
    expect(screen.getByText(/Hasta .*2027/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Cambiar fecha de fin de Piso'))
    fireEvent.change(screen.getByLabelText('Último mes'), { target: { value: '2028-06' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(st.editRule).toHaveBeenCalledWith(3, { concepto: 'Piso', importe: 700, dia: 1, desde: '2026-12', hasta: '2028-06' }))
  })
  it('«sin fecha de fin» envía hasta null', async () => {
    st.rules = [{ id: 3, concepto: 'Piso', importe: 700, dia: 1, desde: '2026-12', hasta: '2027-12' }]
    st.editRule.mockResolvedValue()
    render(<FixedRecurring />)
    fireEvent.click(screen.getByLabelText('Cambiar fecha de fin de Piso'))
    fireEvent.click(screen.getByLabelText('Sin fecha de fin'))
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(st.editRule.mock.calls[0][1].hasta).toBeNull())
  })
})
