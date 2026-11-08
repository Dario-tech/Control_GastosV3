// Detalle de «Suscripciones» en Mes: desglose por servicio con logo; otras categorías, sin desglose.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const txs = vi.hoisted(() => ({ list: [] }))
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ transactions: txs.list, refresh: vi.fn() }) }))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast: vi.fn() }) }))
vi.mock('../src/hooks/useHideAmounts', () => ({ useHideAmounts: () => false }))
vi.mock('../src/hooks/useLockBodyScroll', () => ({ useLockBodyScroll: () => {} }))

import TransactionLogModal from '../src/components/ui/TransactionLogModal'

afterEach(() => { cleanup(); txs.list = [] })

const tx = (rowIndex, concepto, comentario, importe) => ({
  rowIndex, fecha: '2026-11-08', month: 10, concepto, comentario, importe, bucket: 'fixedExpenses', tipo: 'Gasto Fijo',
})
const render1 = concept => render(<TransactionLogModal concept={concept} emoji="📺" monthIndex={10} year={2026} onClose={() => {}} />)

describe('detalle de Suscripciones', () => {
  it('desglosa por servicio con su logo y total', () => {
    txs.list = [tx(1, 'Suscripciones', 'HBO', 10), tx(2, 'Suscripciones', 'Netflix · familiar', 13), tx(3, 'Suscripciones', '', 5)]
    render1('Suscripciones')
    expect(screen.getByText('Por suscripción')).toBeTruthy()
    expect(screen.getAllByText('HBO Max').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Netflix').length).toBeGreaterThan(0)
    expect(screen.getByText('Sin especificar')).toBeTruthy()
    expect(screen.getAllByRole('img', { name: 'Netflix' }).length).toBeGreaterThan(0)
  })
  it('otras categorías no llevan desglose', () => {
    txs.list = [tx(1, 'Piso', 'alquiler', 700)]
    render1('Piso')
    expect(screen.queryByText('Por suscripción')).toBeNull()
  })
})
