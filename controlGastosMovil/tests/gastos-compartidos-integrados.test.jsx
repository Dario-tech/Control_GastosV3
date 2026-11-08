// Gastos compartidos integrados: «Dividir» al apuntar un gasto y pantalla «Cuentas».
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const estado = (extra = {}) => ({
  personas: [{ clave: 'p:1', id: 1, nombre: 'Ana', saldo: 20 }], gastos: [], pagos: [],
  por_transaccion: {}, saldo_total: 20, ...extra,
})
const api = vi.hoisted(() => ({
  fetchShared: vi.fn(), addSharedPerson: vi.fn(), deleteSharedPerson: vi.fn(), postSharedExpense: vi.fn(),
  postTransaction: vi.fn(), addSharedSettlement: vi.fn(), deleteSharedSettlement: vi.fn(), deleteSharedExpense: vi.fn(),
}))
const refresh = vi.fn()
vi.mock('../src/context/FinanceDataContext', () => ({
  useFinanceData: () => ({ refresh, data: { transactions: [] }, transactions: [] }),
}))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast: vi.fn() }) }))
vi.mock('../src/context/SettingsContext', async o => ({
  ...(await o()),
  useSettings: () => ({
    customCategories: { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }, addCategory: vi.fn(),
    settings: { theme: 'dark', accent: '#6366f1', hideAmounts: false, currency: 'EUR' },
  }),
}))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
vi.mock('../src/hooks/useHideAmounts', () => ({ useHideAmounts: () => false }))
vi.mock('../src/services/api', async o => ({ ...(await o()), ...api }))

import AddTransactionModal from '../src/components/ui/AddTransactionModal'
import CuentasScreen from '../src/components/ui/CuentasScreen'

afterEach(() => { cleanup(); vi.clearAllMocks() })

async function abrirDividir() {
  api.fetchShared.mockResolvedValue(estado())
  render(<AddTransactionModal onClose={vi.fn()} />)
  fireEvent.click(screen.getByText('Gasto Variable'))
  fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '60' } })
  fireEvent.click(screen.getByText(DEFAULT_CATEGORIES['Gasto Variable'][0].concepto))
  fireEvent.click(screen.getByRole('switch', { name: /Dividir con otras personas/ }))
  await screen.findByText('Ana')
}

describe('Dividir al apuntar un gasto', () => {
  it('sin dividir se guarda un movimiento normal', async () => {
    api.fetchShared.mockResolvedValue(estado())
    api.postTransaction.mockResolvedValue({})
    render(<AddTransactionModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Gasto Variable'))
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '12' } })
    fireEvent.click(screen.getByText(DEFAULT_CATEGORIES['Gasto Variable'][0].concepto))
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(api.postTransaction).toHaveBeenCalled())
    expect(api.postSharedExpense).not.toHaveBeenCalled()
  })

  it('no deja guardar hasta elegir con quién y envía el reparto', async () => {
    await abrirDividir()
    expect(screen.getByRole('button', { name: /Guardar/ }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Ana' }))
    const guardar = screen.getByRole('button', { name: /Guardar/ })
    expect(guardar.disabled).toBe(false)
    api.postSharedExpense.mockResolvedValue({})
    fireEvent.click(guardar)
    await waitFor(() => expect(api.postSharedExpense).toHaveBeenCalled())
    const body = api.postSharedExpense.mock.calls[0][0]
    expect(body).toMatchObject({ importe: 60, tipo: 'Gasto Variable', pagado_por: 'yo', reparto: { modo: 'igual', participantes: ['yo', 'p:1'] } })
    expect(api.postTransaction).not.toHaveBeenCalled()
  })

  it('por importes exige que sumen el total', async () => {
    await abrirDividir()
    fireEvent.click(screen.getByRole('button', { name: 'Ana' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Por importes' }))
    fireEvent.change(screen.getByLabelText('Parte de Yo'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Parte de Ana'), { target: { value: '30' } })
    expect(screen.getByText(/Faltan/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Guardar/ }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Parte de Ana'), { target: { value: '40' } })
    expect(screen.getByRole('button', { name: /Guardar/ }).disabled).toBe(false)
  })

  it('los ingresos no se dividen', () => {
    api.fetchShared.mockResolvedValue(estado())
    render(<AddTransactionModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Ingreso'))
    expect(screen.queryByRole('switch', { name: /Dividir/ })).toBeNull()
  })
})

describe('Cuentas', () => {
  const shared = (st = estado()) => ({ state: st, apply: vi.fn(), reload: vi.fn(), loading: false, error: '' })

  it('muestra quién te debe y liquida sin crear movimientos', async () => {
    const s = shared()
    api.addSharedSettlement.mockResolvedValue(estado({ saldo_total: 0 }))
    render(<CuentasScreen shared={s} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Ana'))
    expect(screen.getByText(/Te debe/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Me ha pagado' }))
    await waitFor(() => expect(api.addSharedSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ persona_id: 1, direccion: 'cobro', importe: 20 })))
    expect(api.postTransaction).not.toHaveBeenCalled()
    await waitFor(() => expect(s.apply).toHaveBeenCalled())
  })

  it('estado vacío y añadir persona', async () => {
    const s = shared(estado({ personas: [], saldo_total: 0 }))
    api.addSharedPerson.mockResolvedValue(estado())
    render(<CuentasScreen shared={s} onClose={vi.fn()} />)
    expect(screen.getByText(/Aún no hay nadie/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Nombre de la persona'), { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }))
    await waitFor(() => expect(api.addSharedPerson).toHaveBeenCalledWith('Ana'))
  })
})
