// CategorizeModal con pagos que llegan de Cartera (comercio + sugerencia con origen).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const refresh = vi.fn()
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ refresh, data: { transactions: [] } }) }))
vi.mock('../src/context/SettingsContext', () => ({ useSettings: () => ({ customCategories: {} }) }))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))

import CategorizeModal, { suggestionBadge } from '../src/components/ui/CategorizeModal'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const base = { id: 5, importe: 12.4, fecha: '2026-10-10', fuente: 'wallet' }
const sug = (origen) => ({ tipo: 'Gasto Variable', concepto: 'Supermercado', origen })

function renderModal(pending, props = {}) {
  const onCategorize = vi.fn().mockResolvedValue(undefined)
  const onDiscard = vi.fn().mockResolvedValue(undefined)
  const onSkip = vi.fn()
  render(<CategorizeModal pending={pending} total={1} onCategorize={onCategorize} onDiscard={onDiscard} onSkip={onSkip} {...props} />)
  return { onCategorize, onDiscard, onSkip }
}

describe('CategorizeModal con comercio', () => {
  it('muestra el comercio como título, importe, fecha y "Como la última vez en…"', () => {
    renderModal({ ...base, comercio: 'Mercadona', suggested: sug('comercio') })
    expect(screen.getByRole('heading', { name: 'Mercadona' })).toBeTruthy()
    expect(screen.getByText('✨ Como la última vez en Mercadona')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Pago pendiente en Mercadona' })).toBeTruthy()
    expect(screen.getByText(/12,40/)).toBeTruthy()
  })

  it('sugerencia por historial muestra "✨ Sugerido" y sin comercio no hay casilla de recordar', () => {
    renderModal({ ...base, comercio: null, suggested: sug('historial') })
    expect(screen.getByText('✨ Sugerido')).toBeTruthy()
    expect(screen.queryByLabelText('Recordar para este comercio')).toBeNull()
  })

  it('suggestionBadge según origen', () => {
    expect(suggestionBadge(sug('comercio'), 'Lidl')).toBe('✨ Como la última vez en Lidl')
    expect(suggestionBadge(sug('comercio'), null)).toBe('✨ Sugerido')
    expect(suggestionBadge(sug('historial'), 'Lidl')).toBe('✨ Sugerido')
    expect(suggestionBadge({ tipo: 'x', concepto: 'y' }, 'Lidl')).toBe('✨ Sugerido')
  })

  it('confirmar la sugerencia envía recordar: true por defecto', async () => {
    const { onCategorize } = renderModal({ ...base, comercio: 'Mercadona', suggested: sug('comercio') })
    expect(screen.getByLabelText('Recordar para este comercio').checked).toBe(true)
    fireEvent.click(screen.getByText('✨ Como la última vez en Mercadona').closest('button'))
    await waitFor(() => expect(onCategorize).toHaveBeenCalledWith(5, 'Gasto Variable', 'Supermercado', { recordar: true, comentario: 'Mercadona' }))
  })

  it('el nombre del comercio viaja como nota del movimiento (y sin comercio no hay nota)', async () => {
    const a = renderModal({ ...base, comercio: '  jamon supermercado ', suggested: sug('comercio') })
    fireEvent.click(screen.getByText(/Como la última vez en/).closest('button'))
    await waitFor(() => expect(a.onCategorize).toHaveBeenCalledWith(5, 'Gasto Variable', 'Supermercado', { recordar: true, comentario: 'jamon supermercado' }))
  })

  it('desmarcar "Recordar para este comercio" envía recordar: false', async () => {
    const { onCategorize } = renderModal({ ...base, comercio: 'Mercadona', suggested: sug('comercio') })
    fireEvent.click(screen.getByLabelText('Recordar para este comercio'))
    fireEvent.click(screen.getByText('✨ Como la última vez en Mercadona').closest('button'))
    await waitFor(() => expect(onCategorize).toHaveBeenCalledWith(5, 'Gasto Variable', 'Supermercado', { recordar: false, comentario: 'Mercadona' }))
  })

  it('"Descartar" pide confirmación y luego llama a onDiscard', async () => {
    const { onDiscard } = renderModal({ ...base, comercio: 'Mercadona', suggested: null })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(onDiscard).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: '¿Descartar este pago?' })
    fireEvent.click(dialog.querySelector('.fm-confirm'))
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith(5))
  })

  it('la campana sigue sin el modo "Gasto recibido" (sin botón Guardar)', () => {
    renderModal({ ...base, comercio: 'Mercadona', suggested: sug('comercio') })
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()
    expect(screen.getByText('Pago pendiente')).toBeTruthy()
  })

  it('cancelar la confirmación no descarta; "Dejar para luego" sigue disponible', () => {
    const { onDiscard, onSkip } = renderModal({ ...base, comercio: 'Mercadona', suggested: null })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onDiscard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Dejar para luego' }))
    expect(onSkip).toHaveBeenCalled()
  })
})

describe('hoja "Gasto recibido" (variant="received")', () => {
  const received = { ...base, id: 41, comercio: 'Mercadona', suggested: sug('comercio') }

  it('muestra importe, comercio y la sugerencia ya elegida; Guardar envía recordar: true', async () => {
    const { onCategorize } = renderModal(received, { variant: 'received' })
    expect(screen.getByRole('dialog', { name: 'Gasto recibido en Mercadona' })).toBeTruthy()
    expect(screen.getByText('Gasto recibido')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Mercadona' })).toBeTruthy()
    expect(screen.getByText(/12,40/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Categoría elegida: Supermercado' })).toBeTruthy()
    expect(screen.getByText('✨ Como la última vez en Mercadona')).toBeTruthy()
    expect(screen.queryByText('Gasto Fijo')).toBeNull()   // no enseña la rejilla de tipos aún

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onCategorize).toHaveBeenCalledWith(41, 'Gasto Variable', 'Supermercado', { recordar: true, comentario: 'Mercadona' }))
  })

  it('"Cambiar categoría" abre tipos y la rejilla de conceptos de CategorizeModal', async () => {
    const { onCategorize } = renderModal(received, { variant: 'received' })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar categoría' }))
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()
    fireEvent.click(screen.getByText('Gasto Fijo').closest('button'))
    const concepto = DEFAULT_CATEGORIES['Gasto Fijo'][0].concepto
    fireEvent.click(screen.getByText(concepto).closest('button'))
    await waitFor(() => expect(onCategorize).toHaveBeenCalledWith(41, 'Gasto Fijo', concepto, { recordar: true, comentario: 'Mercadona' }))
  })

  it('"Descartar" con confirmación llama a onDiscard', async () => {
    const { onDiscard } = renderModal(received, { variant: 'received' })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    fireEvent.click(screen.getByRole('dialog', { name: '¿Descartar este pago?' }).querySelector('.fm-confirm'))
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith(41))
  })

  it('sin sugerencia va directo a elegir tipo', () => {
    renderModal({ ...received, suggested: null }, { variant: 'received' })
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()
    expect(screen.getByText('¿Qué tipo de movimiento es?')).toBeTruthy()
  })
})
