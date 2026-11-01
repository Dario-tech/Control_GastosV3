// Ocultar una categoría por defecto no afecta a lo ya guardado.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const state = vi.hoisted(() => ({
  hiddenCategories: [{ tipo: 'Gasto Variable', concepto: 'Ocio' }],
  customCategories: { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] },
}))
vi.mock('../src/context/SettingsContext', async (o) => ({ ...(await o()), useSettings: () => state }))
vi.mock('../src/context/FinanceDataContext', async (o) => ({ ...(await o()), useFinanceData: () => ({ refresh: vi.fn(), data: { transactions: [] } }) }))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast: vi.fn() }) }))
vi.mock('../src/services/api', async (o) => ({ ...(await o()), updateTransaction: vi.fn(async () => ({})), deleteTransaction: vi.fn() }))

import TransactionEditModal from '../src/components/ui/TransactionEditModal'
import BudgetModal from '../src/components/ui/BudgetModal'
import AddTransactionModal from '../src/components/ui/AddTransactionModal'
import { updateTransaction } from '../src/services/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const tx = { rowIndex: 7, fecha: '2025-01-02', tipo: 'Gasto Variable', concepto: 'Ocio', importe: 10, comentario: '' }

describe('categoría oculta y datos existentes', () => {
  it('editar un movimiento: la oculta sigue seleccionada, marcada y se guarda sin tocarla', async () => {
    const onSaved = vi.fn()
    render(<TransactionEditModal tx={tx} emoji="🎉" onClose={() => {}} onSaved={onSaved} />)
    const radio = screen.getByRole('radio', { name: /Ocio \(oculta\)/ })
    expect(radio.getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByLabelText(/importe/i, { selector: 'input' }), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))
    await waitFor(() => expect(updateTransaction).toHaveBeenCalled())
    expect(updateTransaction.mock.calls[0][1]).not.toHaveProperty('concepto')
  })

  it('editar un movimiento: las ocultas de otras categorías no se ofrecen', () => {
    render(<TransactionEditModal tx={{ ...tx, concepto: 'Comida' }} onClose={() => {}} />)
    expect(screen.queryByRole('radio', { name: /Ocio/ })).toBeNull()
  })

  it('presupuesto existente de una categoría oculta se ve y se edita', () => {
    render(<BudgetModal item={{ name: 'Ocio', emoji: '🎉', limit: 50, color: '#fff', tipo: 'Gasto Variable' }} onSave={() => {}} onClose={() => {}} />)
    expect(screen.getAllByText('Ocio').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Guardar cambios/ }).disabled).toBe(false)
  })

  it('un movimiento nuevo no ofrece la oculta', () => {
    render(<AddTransactionModal onClose={() => {}} />)
    fireEvent.click(screen.getByText('Gasto Variable'))
    expect(screen.queryByText('Ocio')).toBeNull()
    expect(screen.getByText('Comida')).toBeTruthy()
  })
})
