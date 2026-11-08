// Categoría «Suscripciones»: pregunta qué servicio es (con logo) solo en esa categoría y lo guarda en la nota.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const settingsState = { customCategories: { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }, addCategory: vi.fn(), settings: { currency: 'EUR' } }
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ refresh: vi.fn(), data: { transactions: [] }, transactions: [] }) }))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast: vi.fn() }) }))
vi.mock('../src/context/SettingsContext', async o => ({ ...(await o()), useSettings: () => settingsState }))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
const api = vi.hoisted(() => ({ postTransaction: vi.fn(async () => ({})) }))
vi.mock('../src/services/api', async o => ({ ...(await o()), ...api }))

import AddTransactionModal from '../src/components/ui/AddTransactionModal'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function abrir(tipo, categoria, comentario) {
  render(<AddTransactionModal onClose={vi.fn()} />)
  fireEvent.click(screen.getByText(tipo))
  fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '12,99' } })
  if (comentario) fireEvent.change(screen.getByPlaceholderText('Añade una nota…'), { target: { value: comentario } })
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(categoria) }))
}
const guardar = () => fireEvent.click(screen.getByRole('button', { name: /^Guardar/ }))

describe('añadir gasto en Suscripciones', () => {
  it('Suscripciones está en Gasto Fijo y pregunta el servicio con logos', () => {
    abrir('Gasto Fijo', 'Suscripciones')
    expect(screen.getByText('¿Qué suscripción es?')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Netflix/ })).toBeTruthy()
    expect(screen.getAllByRole('img', { name: 'Netflix' }).length).toBeGreaterThan(0)   // logo accesible
  })

  it('en otras categorías NO pregunta nada', () => {
    abrir('Gasto Fijo', 'Piso')
    expect(screen.queryByText('¿Qué suscripción es?')).toBeNull()
  })

  it('el servicio elegido va a la nota; es opcional', async () => {
    abrir('Gasto Fijo', 'Suscripciones')
    fireEvent.click(screen.getByRole('radio', { name: /Netflix/ }))
    guardar()
    await waitFor(() => expect(api.postTransaction).toHaveBeenCalled())
    expect(api.postTransaction.mock.calls[0][4]).toBe('Netflix')
    api.postTransaction.mockClear(); cleanup()
    abrir('Gasto Fijo', 'Suscripciones')                       // sin elegir servicio
    guardar()
    await waitFor(() => expect(api.postTransaction).toHaveBeenCalled())
    expect(api.postTransaction.mock.calls[0][4]).toBeNull()
  })

  it('«Otra» usa el nombre escrito y se junta con la nota del usuario', async () => {
    abrir('Gasto Fijo', 'Suscripciones', 'plan anual')
    fireEvent.click(screen.getByRole('radio', { name: /Otra/ }))
    fireEvent.change(screen.getByLabelText('Nombre de la suscripción'), { target: { value: 'Duolingo' } })
    guardar()
    await waitFor(() => expect(api.postTransaction).toHaveBeenCalled())
    expect(api.postTransaction.mock.calls[0][4]).toBe('Duolingo · plan anual')
  })
})
