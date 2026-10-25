// Pantalla de búsqueda de movimientos (API simulada) y su punto de entrada en la cabecera.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

vi.mock('../src/services/api', () => ({ searchTransactions: vi.fn() }))
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ data: { year: 2026 } }) }))
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Ana Pérez' } }) }))

import { searchTransactions } from '../src/services/api'
import TransactionSearchModal, { searchErrorMessage } from '../src/components/ui/TransactionSearchModal'
import Header from '../src/components/layout/Header'

const row = (id, concepto, importe, bucket = 'variableExpenses') =>
  ({ rowIndex: id, fecha: '2026-10-05', concepto, importe, bucket, comentario: '' })

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('Header', () => {
  it('tiene un botón «Buscar movimientos» que avisa al pulsarlo', () => {
    const onSearchClick = vi.fn()
    render(<Header onSearchClick={onSearchClick} onAddClick={() => {}} onAvatarClick={() => {}} pendingCount={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar movimientos' }))
    expect(onSearchClick).toHaveBeenCalledTimes(1)
  })
})

describe('TransactionSearchModal', () => {
  it('se abre con foco en el campo y carga los últimos movimientos', async () => {
    searchTransactions.mockResolvedValue({ results: [row(1, 'Mercadona', 25)], next_cursor: null })
    render(<TransactionSearchModal onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Buscar movimientos' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Buscar por concepto'))
    expect(await screen.findByText('Mercadona')).toBeTruthy()
    expect(searchTransactions).toHaveBeenCalledWith({ q: '', tipo: 'all', limit: 30 })
  })

  it('busca con la query y el filtro', async () => {
    searchTransactions.mockResolvedValue({ results: [], next_cursor: null })
    render(<TransactionSearchModal onClose={() => {}} />)
    await screen.findByText('Aún no hay movimientos')
    searchTransactions.mockResolvedValue({ results: [row(2, 'Netflix', 12)], next_cursor: null })
    fireEvent.click(screen.getByRole('button', { name: 'Fijos' }))
    fireEvent.change(screen.getByLabelText('Buscar por concepto'), { target: { value: ' netf ' } })
    await waitFor(() => expect(searchTransactions).toHaveBeenLastCalledWith({ q: 'netf', tipo: 'fixedExpenses', limit: 30 }), { timeout: 2000 })
    expect(await screen.findByText('Netflix')).toBeTruthy()
  })

  it('muestra el estado vacío con la búsqueda', async () => {
    searchTransactions.mockResolvedValue({ results: [], next_cursor: null })
    render(<TransactionSearchModal onClose={() => {}} />)
    await screen.findByText('Aún no hay movimientos')
    fireEvent.change(screen.getByLabelText('Buscar por concepto'), { target: { value: 'zzz' } })
    expect(await screen.findByText('Sin resultados para «zzz»', {}, { timeout: 2000 })).toBeTruthy()
  })

  it('muestra el error y permite reintentar', async () => {
    searchTransactions.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<TransactionSearchModal onClose={() => {}} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Sin conexión/)
    searchTransactions.mockResolvedValue({ results: [row(3, 'Gasolina', 40)], next_cursor: null })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Gasolina')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('«Cargar más» añade la página siguiente con el cursor', async () => {
    searchTransactions.mockResolvedValueOnce({ results: [row(1, 'Uno', 1)], next_cursor: '2026-10-05_1' })
    render(<TransactionSearchModal onClose={() => {}} />)
    await screen.findByText('Uno')
    searchTransactions.mockResolvedValueOnce({ results: [row(0, 'Dos', 2)], next_cursor: null })
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByText('Dos')).toBeTruthy()
    expect(screen.getByText('Uno')).toBeTruthy()
    expect(searchTransactions).toHaveBeenLastCalledWith({ q: '', tipo: 'all', cursor: '2026-10-05_1', limit: 30 })
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull()
  })

  it('si falla «Cargar más» conserva los resultados', async () => {
    searchTransactions.mockResolvedValueOnce({ results: [row(1, 'Uno', 1)], next_cursor: 'c' })
    render(<TransactionSearchModal onClose={() => {}} />)
    await screen.findByText('Uno')
    searchTransactions.mockRejectedValueOnce(new Error('API 500'))
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Uno')).toBeTruthy()
  })

  it('Escape y la X cierran', async () => {
    searchTransactions.mockResolvedValue({ results: [], next_cursor: null })
    const onClose = vi.fn()
    render(<TransactionSearchModal onClose={onClose} />)
    await screen.findByText('Aún no hay movimientos')
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar búsqueda' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('searchErrorMessage', () => {
  it('traduce timeouts y fallos de red', () => {
    expect(searchErrorMessage(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toMatch(/despertando/)
    expect(searchErrorMessage(new TypeError('x'))).toMatch(/Sin conexión/)
    expect(searchErrorMessage(new Error('API 500'))).toBe('API 500')
  })
})
