// Ajustes: nota de moneda, exportar JSON/CSV, categorías por defecto ocultas, pantalla sólida y ayuda del emoji.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const showToast = vi.fn()
const setHiddenCategories = vi.fn()
const settingsState = {
  customCategories: { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] },
  addCategory: vi.fn(), removeCategory: vi.fn(), update: vi.fn(),
  hiddenCategories: [], setHiddenCategories,
  settings: { theme: 'dark', accent: '#6366f1', hideAmounts: false, currency: 'EUR', budgetAlerts: true, alertThreshold: 80 },
}
const exportMocks = vi.hoisted(() => ({
  fetchAllTransactions: vi.fn(), fetchExtras: vi.fn(), downloadText: vi.fn(),
}))

vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast }) }))
vi.mock('../src/context/SettingsContext', async (importOriginal) => ({ ...(await importOriginal()), useSettings: () => settingsState }))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
vi.mock('../src/hooks/useBudget', async (importOriginal) => ({ ...(await importOriginal()), useBudget: () => ({ allItems: [], removeItem: vi.fn() }) }))
vi.mock('../src/utils/exportData', async (importOriginal) => ({ ...(await importOriginal()), ...exportMocks }))
vi.mock('../src/services/api', async (importOriginal) => ({ ...(await importOriginal()), suggestEmoji: vi.fn(), sendMonthlyReport: vi.fn() }))

import SettingsTab from '../src/components/tabs/SettingsTab'

beforeEach(() => {
  settingsState.hiddenCategories = []
  settingsState.customCategories = { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('moneda', () => {
  it('avisa de que solo cambia el símbolo', () => {
    render(<SettingsTab initialScreen="appearance" />)
    expect(screen.getByText('Solo cambia el símbolo; no convierte importes.')).toBeTruthy()
  })
})

describe('exportar', () => {
  it('CSV: estado «Preparando…», descarga con fecha y toast', async () => {
    let done
    exportMocks.fetchAllTransactions.mockReturnValue(new Promise(r => { done = r }))
    render(<SettingsTab initialScreen="data" />)
    fireEvent.click(screen.getByRole('button', { name: 'Exportar movimientos en CSV' }))
    expect((await screen.findAllByText('Preparando…')).length).toBe(1)
    done({ transactions: [{ fecha: '2025-01-02', bucket: 'income', concepto: 'Nómina', importe: 10 }], years: [2025], unreadable: 0 })
    await waitFor(() => expect(exportMocks.downloadText).toHaveBeenCalled())
    const [text, name, type] = exportMocks.downloadText.mock.calls[0]
    expect(name).toMatch(/^mi-economia-movimientos-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(type).toContain('text/csv')
    expect(text).toContain('2025-01-02;Ingreso;Nómina;10,00;')
    await waitFor(() => expect(screen.queryByText('Preparando…')).toBeNull())
  })
  it('JSON: incluye movimientos y extras', async () => {
    exportMocks.fetchAllTransactions.mockResolvedValue({ transactions: [{ fecha: '2025-01-02', bucket: 'income', concepto: 'X', importe: 1 }], years: [2025], unreadable: 0 })
    exportMocks.fetchExtras.mockResolvedValue({ goals: [{ id: 1 }], annualExpenses: [] })
    render(<SettingsTab initialScreen="data" />)
    fireEvent.click(screen.getByRole('button', { name: 'Exportar datos (JSON)' }))
    await waitFor(() => expect(exportMocks.downloadText).toHaveBeenCalled())
    const data = JSON.parse(exportMocks.downloadText.mock.calls[0][0])
    expect(data.transactions).toHaveLength(1)
    expect(data.goals).toEqual([{ id: 1 }])
    expect(data.years).toEqual([2025])
  })
  it('un fallo muestra un mensaje claro y no descarga', async () => {
    exportMocks.fetchAllTransactions.mockRejectedValue(new TypeError('network'))
    render(<SettingsTab initialScreen="data" />)
    fireEvent.click(screen.getByRole('button', { name: 'Exportar movimientos en CSV' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/servidor/)
    expect(exportMocks.downloadText).not.toHaveBeenCalled()
  })
})

const renderCats = () => {
  render(<SettingsTab initialScreen="categories" />)
  // Los grupos vienen plegados: se despliegan los tres
  screen.getAllByRole('button', { expanded: false }).forEach(b => fireEvent.click(b))
}

describe('categorías por defecto', () => {
  it('oculta una categoría con botón accesible', () => {
    renderCats()
    const btn = screen.getByRole('button', { name: 'Ocultar la categoría Ocio' })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(setHiddenCategories).toHaveBeenCalledWith([{ tipo: 'Gasto Variable', concepto: 'Ocio' }])
    expect(screen.getByText(/no cambian/)).toBeTruthy()
  })
  it('muestra contador y permite mostrar una o todas', () => {
    settingsState.hiddenCategories = [{ tipo: 'Gasto Variable', concepto: 'Ocio' }, { tipo: 'Gasto Fijo', concepto: 'Luz' }]
    renderCats()
    expect(screen.getByText('2 ocultas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar la categoría Ocio' }))
    expect(setHiddenCategories).toHaveBeenLastCalledWith([{ tipo: 'Gasto Fijo', concepto: 'Luz' }])
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todas' }))
    expect(setHiddenCategories).toHaveBeenLastCalledWith([])
  })
  it('no deja ocultar la última visible de un tipo', () => {
    settingsState.hiddenCategories = [{ tipo: 'Ingreso', concepto: 'Nómina' }]
    renderCats()
    const last = screen.getByRole('button', { name: 'Ocultar la categoría Otros motivos' })
    expect(last.disabled).toBe(true)
    fireEvent.click(last)
    expect(setHiddenCategories).not.toHaveBeenCalled()
  })
  it('una categoría propia cuenta como visible del tipo', () => {
    settingsState.hiddenCategories = [{ tipo: 'Ingreso', concepto: 'Nómina' }]
    settingsState.customCategories = { ...settingsState.customCategories, Ingreso: [{ concepto: 'Freelance', emoji: '💻' }] }
    renderCats()
    expect(screen.getByRole('button', { name: 'Ocultar la categoría Otros motivos' }).disabled).toBe(false)
  })
})

describe('Nueva categoría', () => {
  it('se abre sobre el body (portal) con fondo sólido y ayuda de la IA', () => {
    const { container } = render(<SettingsTab initialScreen="categories" />)
    fireEvent.click(screen.getByRole('button', { name: /nueva categoría/i }))
    const dlg = screen.getByRole('dialog', { name: 'Nueva categoría' })
    expect(dlg.className).toContain('fm-screen--solid')
    expect(container.contains(dlg)).toBe(false)
    const ai = screen.getByRole('button', { name: 'Sugerir emoji con IA' })
    expect(ai.title).toBe('Envía solo el nombre de la categoría a un servicio de IA para sugerir el emoji')
    expect(ai.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(ai.getAttribute('aria-describedby')).textContent).toContain('solo el nombre')
  })
})
