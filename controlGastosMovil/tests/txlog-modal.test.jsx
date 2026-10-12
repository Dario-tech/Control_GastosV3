// Hoja de detalle de categoría + editor de movimiento (contextos y API simulados).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const refresh   = vi.fn()
const showToast = vi.fn()
let transactions = []

vi.mock('../src/context/FinanceDataContext', () => ({
  useFinanceData: () => ({ transactions, refresh }),
}))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast }) }))
vi.mock('../src/context/SettingsContext', () => ({ useSettings: () => ({ customCategories: {} }) }))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
vi.mock('../src/services/api', () => ({
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))

import { updateTransaction, deleteTransaction } from '../src/services/api'
import TransactionLogModal from '../src/components/ui/TransactionLogModal'
import TransactionEditModal from '../src/components/ui/TransactionEditModal'

const tx = (rowIndex, fecha, importe, extra = {}) => ({
  rowIndex, fecha, importe, concepto: 'Ocio', bucket: 'variableExpenses',
  month: parseInt(fecha.slice(5, 7), 10) - 1, comentario: '', ...extra,
})

beforeEach(() => {
  transactions = [
    tx(1, '2026-10-02', 21),
    tx(2, '2026-10-11', 111, { comentario: 'Concierto' }),
    tx(6, '2026-09-20', 100),
  ]
  vi.clearAllMocks()
})
afterEach(cleanup)

function renderLog() {
  return render(<TransactionLogModal concept="Ocio" emoji="🎉" monthIndex={9} year={2026} onClose={() => {}} />)
}

describe('TransactionLogModal', () => {
  it('muestra resumen, comentario en vez del concepto y sin papeleras', () => {
    renderLog()
    expect(screen.getByRole('dialog', { name: 'Ocio' })).toBeTruthy()
    expect(screen.getByText('Concierto')).toBeTruthy()
    expect(screen.getByText('movimientos')).toBeTruthy()
    expect(screen.getByText('▲ 32%')).toBeTruthy()          // 132 vs 100
    expect(screen.queryByLabelText('Eliminar')).toBeNull()
    // Más reciente primero
    const rows = screen.getAllByRole('button', { name: /^Editar movimiento/ })
    expect(rows[0].getAttribute('aria-label')).toMatch(/domingo 11 de octubre, nota: Concierto/)
    expect(rows[1].getAttribute('aria-label')).toMatch(/viernes 2 de octubre/)
  })

  it('al cambiar la fecha a otro mes, guarda solo la fecha y la fila desaparece', async () => {
    updateTransaction.mockResolvedValue({ id: 2, fecha: '2026-09-30', tipo: 'Gasto Variable', concepto: 'Ocio', importe: 111, comentario: 'Concierto' })
    renderLog()
    fireEvent.click(screen.getAllByRole('button', { name: /^Editar movimiento/ })[0])
    const editor = screen.getByRole('dialog', { name: 'Editar movimiento' })
    const save = within(editor).getByRole('button', { name: 'Guardar cambios' })
    expect(save.disabled).toBe(true)
    fireEvent.click(within(editor).getByRole('button', { name: 'Otra fecha' }))
    fireEvent.change(editor.querySelector('input[type="date"]'), { target: { value: '2026-09-30' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith(2, { fecha: '2026-09-30' }))
    await waitFor(() => expect(screen.queryByText('Concierto')).toBeNull())
    expect(refresh).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/movido a septiembre/))
  })

  it('eliminar pide confirmación y quita la fila', async () => {
    deleteTransaction.mockResolvedValue({ ok: true })
    renderLog()
    fireEvent.click(screen.getAllByRole('button', { name: /^Editar movimiento/ })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar movimiento' }))
    expect(deleteTransaction).not.toHaveBeenCalled()
    const confirm = screen.getByRole('dialog', { name: '¿Eliminar este movimiento?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Editar movimiento/ })).toHaveLength(1))
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/eliminado/))
  })
})

describe('TransactionEditModal', () => {
  const original = tx(2, '2026-10-11', 111, { comentario: 'Concierto' })

  it('precarga los datos y envía solo los campos cambiados', async () => {
    updateTransaction.mockResolvedValue({ id: 2 })
    const onSaved = vi.fn()
    render(<TransactionEditModal tx={original} emoji="🎉" onClose={() => {}} onSaved={onSaved} />)
    const amount = screen.getByLabelText('Importe')
    expect(amount.value).toBe('111')
    expect(screen.getByRole('radio', { name: /Ocio/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Variable' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(amount, { target: { value: '99,90' } })
    fireEvent.change(screen.getByLabelText(/Comentario/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith(2, { importe: 99.9, comentario: '' }))
    expect(onSaved).toHaveBeenCalled()
  })

  it('cambiar de tipo obliga a elegir categoría del nuevo tipo', () => {
    render(<TransactionEditModal tx={original} emoji="🎉" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Fijo' }))
    expect(screen.getByRole('button', { name: 'Guardar cambios' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /Luz/ }))
    expect(screen.getByRole('button', { name: 'Guardar cambios' }).disabled).toBe(false)
  })

  it('muestra el detail del backend si responde 422', async () => {
    updateTransaction.mockRejectedValue(new Error('La fecha no puede ser futura'))
    render(<TransactionEditModal tx={original} emoji="🎉" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Importe'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect((await screen.findByRole('alert')).textContent).toMatch('La fecha no puede ser futura')
  })
})
