// Añadir un Gasto Fijo con «Repetir cada mes … hasta»: crea la regla tras guardar el movimiento.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const showToast = vi.fn()
const settingsState = { customCategories: { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }, addCategory: vi.fn(), settings: { currency: 'EUR' } }
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ refresh: vi.fn(), data: { transactions: [] }, transactions: [] }) }))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast }) }))
vi.mock('../src/context/SettingsContext', async o => ({ ...(await o()), useSettings: () => settingsState }))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
const api = vi.hoisted(() => ({ postTransaction: vi.fn(async () => ({})), createFixedRecurring: vi.fn(async () => ({})) }))
vi.mock('../src/services/api', async o => ({ ...(await o()), ...api }))

import AddTransactionModal from '../src/components/ui/AddTransactionModal'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function fill(tipo, categoria) {
  render(<AddTransactionModal onClose={vi.fn()} />)
  fireEvent.click(screen.getByText(tipo))
  fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '700' } })
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(categoria) }))
}
const save = () => fireEvent.click(screen.getByRole('button', { name: /^Guardar/ }))

describe('gasto fijo que se repite', () => {
  it('solo ofrece repetir en Gasto Fijo', () => {
    fill('Gasto Variable', 'Ocio')
    expect(screen.queryByText('Repetir cada mes')).toBeNull()
  })

  it('por defecto no repite: solo guarda el movimiento', async () => {
    fill('Gasto Fijo', 'Piso')
    save()
    await waitFor(() => expect(api.postTransaction).toHaveBeenCalled())
    expect(api.createFixedRecurring).not.toHaveBeenCalled()
  })

  it('con «Repetir cada mes» y un mes de fin crea la regla desde el mes siguiente', async () => {
    fill('Gasto Fijo', 'Piso')
    fireEvent.click(screen.getByRole('switch', { name: /Repetir cada mes/ }))
    fireEvent.change(screen.getByLabelText('Hasta el mes de'), { target: { value: '2099-12' } })
    save()
    await waitFor(() => expect(api.createFixedRecurring).toHaveBeenCalled())
    const regla = api.createFixedRecurring.mock.calls[0][0]
    expect(regla).toMatchObject({ concepto: 'Piso', importe: 700, hasta: '2099-12' })
    expect(regla.desde).toMatch(/^\d{4}-\d{2}$/)
    expect(regla.dia).toBeGreaterThanOrEqual(1)
  })

  it('«Sin fecha de fin» manda hasta null', async () => {
    fill('Gasto Fijo', 'Piso')
    fireEvent.click(screen.getByRole('switch', { name: /Repetir cada mes/ }))
    fireEvent.click(screen.getByRole('switch', { name: /Sin fecha de fin/ }))
    save()
    await waitFor(() => expect(api.createFixedRecurring).toHaveBeenCalled())
    expect(api.createFixedRecurring.mock.calls[0][0].hasta).toBeNull()
  })

  it('si falla la repetición, el movimiento queda guardado y se avisa', async () => {
    api.createFixedRecurring.mockRejectedValueOnce(new Error('x'))
    fill('Gasto Fijo', 'Piso')
    fireEvent.click(screen.getByRole('switch', { name: /Repetir cada mes/ }))
    fireEvent.click(screen.getByRole('switch', { name: /Sin fecha de fin/ }))
    save()
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/no se pudo programar/)))
    expect(api.postTransaction).toHaveBeenCalledTimes(1)
  })
})
