// Ajustes: el motivo por el que «Ocultar» está deshabilitado se ve como texto, no solo en title.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const settingsState = {
  customCategories: { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] },
  addCategory: vi.fn(), removeCategory: vi.fn(), update: vi.fn(),
  hiddenCategories: DEFAULT_CATEGORIES['Ingreso'].slice(1).map(c => ({ tipo: 'Ingreso', concepto: c.concepto })),
  setHiddenCategories: vi.fn(),
  settings: { theme: 'dark', accent: '#6366f1', hideAmounts: false, currency: 'EUR', budgetAlerts: true, alertThreshold: 80 },
}
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast: vi.fn() }) }))
vi.mock('../src/context/SettingsContext', async (importOriginal) => ({ ...(await importOriginal()), useSettings: () => settingsState }))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
vi.mock('../src/hooks/useBudget', async (importOriginal) => ({ ...(await importOriginal()), useBudget: () => ({ allItems: [], removeItem: vi.fn() }) }))

import SettingsTab from '../src/components/tabs/SettingsTab'

afterEach(cleanup)

describe('última categoría visible', () => {
  it('muestra el motivo como texto y enlazado al botón deshabilitado', () => {
    render(<SettingsTab initialScreen="categories" />)
    // Los grupos de categorías por defecto vienen plegados
    fireEvent.click(screen.getByRole('button', { name: /Ingresos/ }))
    const note = screen.getByText('Debe quedar al menos una categoría visible de este tipo')
    expect(note.tagName).toBe('P')
    const btn = screen.getByRole('button', { name: `Ocultar la categoría ${DEFAULT_CATEGORIES['Ingreso'][0].concepto}` })
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-describedby')).toBe(note.id)
  })
})
