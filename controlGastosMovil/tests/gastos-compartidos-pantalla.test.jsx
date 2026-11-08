import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  fetchGroups: vi.fn(), fetchGroup: vi.fn(), createGroup: vi.fn(), deleteGroup: vi.fn(), inviteToGroup: vi.fn(),
  addGroupExpense: vi.fn(), deleteGroupExpense: vi.fn(), addGroupSettlement: vi.fn(), deleteGroupSettlement: vi.fn(),
}))
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: { email: 'a@x.es' } }) }))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast: vi.fn() }) }))
vi.mock('../src/hooks/useHideAmounts', () => ({ useHideAmounts: () => false }))
vi.mock('../src/services/api', async o => ({ ...(await o()), ...api }))

import GroupsScreen from '../src/components/profile/GroupsScreen'

const miembros = [{ email: 'a@x.es', nombre: 'Ana' }, { email: 'b@x.es', nombre: 'Beto' }]
const grupo = (extra = {}) => ({
  id: 1, nombre: 'Viaje', creado_por: 'a@x.es', miembros, gastos: [], pagos: [], saldos: { 'a@x.es': 0, 'b@x.es': 0 }, deudas: [], sin_leer: 0, ...extra,
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('GroupsScreen', () => {
  it('estado vacío y crear grupo', async () => {
    api.fetchGroups.mockResolvedValueOnce([]).mockResolvedValue([{ id: 1, nombre: 'Viaje', creado_por: 'a@x.es', miembros }])
    api.createGroup.mockResolvedValue(grupo())
    api.fetchGroup.mockResolvedValue(grupo())
    render(<GroupsScreen />)
    await screen.findByText(/Aún no tienes grupos/)
    fireEvent.change(screen.getByLabelText('Nombre del grupo'), { target: { value: 'Viaje' } })
    fireEvent.click(screen.getByText('Crear'))
    await screen.findByText('Quién debe a quién')
    expect(api.createGroup).toHaveBeenCalledWith('Viaje')
  })

  it('muestra deudas y permite marcar un pago', async () => {
    api.fetchGroups.mockResolvedValue([{ id: 1, nombre: 'Viaje', creado_por: 'a@x.es', miembros }])
    const g = grupo({ saldos: { 'a@x.es': 30, 'b@x.es': -30 }, deudas: [{ de: 'b@x.es', a: 'a@x.es', importe: 30 }] })
    api.fetchGroup.mockResolvedValue(g)
    api.addGroupSettlement.mockResolvedValue(grupo())
    render(<GroupsScreen />)
    fireEvent.click(await screen.findByText('Viaje'))
    await screen.findByText(/Beto debe 30,00 € a Ana/)
    fireEvent.click(screen.getByText('Marcar pagado'))
    await waitFor(() => expect(api.addGroupSettlement).toHaveBeenCalledWith(1, { de: 'b@x.es', a: 'a@x.es', importe: 30 }))
    await screen.findByText('Todo saldado 🎉')
  })

  it('añade un gasto a partes iguales', async () => {
    api.fetchGroups.mockResolvedValue([{ id: 1, nombre: 'Viaje', creado_por: 'a@x.es', miembros }])
    api.fetchGroup.mockResolvedValue(grupo())
    api.addGroupExpense.mockResolvedValue(grupo())
    render(<GroupsScreen />)
    fireEvent.click(await screen.findByText('Viaje'))
    fireEvent.click(await screen.findByText('Añadir gasto'))
    fireEvent.change(screen.getByLabelText('Concepto'), { target: { value: 'Cena' } })
    fireEvent.change(screen.getByLabelText('Importe'), { target: { value: '45,50' } })
    fireEvent.click(screen.getByText('Guardar gasto'))
    await waitFor(() => expect(api.addGroupExpense).toHaveBeenCalled())
    expect(api.addGroupExpense.mock.calls[0][1]).toEqual({
      concepto: 'Cena', importe: 45.5, pagado_por: 'a@x.es', reparto: { modo: 'igual', participantes: ['a@x.es', 'b@x.es'] } })
  })

  it('valida en el cliente antes de enviar', async () => {
    api.fetchGroups.mockResolvedValue([{ id: 1, nombre: 'Viaje', creado_por: 'a@x.es', miembros }])
    api.fetchGroup.mockResolvedValue(grupo())
    render(<GroupsScreen />)
    fireEvent.click(await screen.findByText('Viaje'))
    fireEvent.click(await screen.findByText('Añadir gasto'))
    fireEvent.click(screen.getByText('Guardar gasto'))
    await screen.findByText('Escribe el concepto.')
    expect(api.addGroupExpense).not.toHaveBeenCalled()
  })
})
