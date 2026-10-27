// Perfil y ajustes (estilo iOS): pantalla principal corta + subpantallas, sin perder funciones.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const showToast = vi.fn()
const logout = vi.fn()
const setHiddenCategories = vi.fn()
const settingsState = {
  customCategories: { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] },
  addCategory: vi.fn(() => true), removeCategory: vi.fn(), update: vi.fn(),
  hiddenCategories: [], setHiddenCategories,
  settings: { theme: 'dark', accent: '#6366f1', hideAmounts: false, currency: 'EUR', budgetAlerts: true, alertThreshold: 80 },
}
const removeItem = vi.fn()
const exportMocks = vi.hoisted(() => ({ fetchAllTransactions: vi.fn(), fetchExtras: vi.fn(), downloadText: vi.fn() }))
const apiMocks = vi.hoisted(() => ({ sendMonthlyReport: vi.fn() }))

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Ana Pérez', email: 'ana@x.es' }, logout }) }))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast }) }))
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ data: { availableYears: [2025] } }) }))
vi.mock('../src/context/SettingsContext', async (importOriginal) => ({ ...(await importOriginal()), useSettings: () => settingsState }))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
vi.mock('../src/hooks/useBudget', async (importOriginal) => ({
  ...(await importOriginal()),
  useBudget: () => ({ allItems: [{ id: 'a' }, { id: 'b' }], removeItem }),
}))
vi.mock('../src/utils/exportData', async (importOriginal) => ({ ...(await importOriginal()), ...exportMocks }))
vi.mock('../src/services/api', async (importOriginal) => ({ ...(await importOriginal()), suggestEmoji: vi.fn(), ...apiMocks }))
vi.mock('../src/components/ui/ShortcutSetupScreen', () => ({
  default: ({ onClose }) => <div role="dialog" aria-label="Guía del Atajo"><button onClick={onClose}>Cerrar guía</button></div>,
}))

import ProfilePanel from '../src/components/layout/ProfilePanel'

const onClose = vi.fn()
const onShowGuide = vi.fn()
const panel = () => screen.getByRole('dialog', { name: 'Perfil y ajustes' })
const renderPanel = (open = true) => render(<ProfilePanel open={open} onClose={onClose} onShowGuide={onShowGuide} />)
const goTo = name => fireEvent.click(within(panel()).getByRole('button', { name: new RegExp(`^${name}`) }))
const title = () => within(panel()).getByRole('heading', { level: 1 }).textContent
const back = () => fireEvent.click(within(panel()).getByRole('button', { name: 'Volver a Perfil y ajustes' }))

beforeEach(() => {
  settingsState.hiddenCategories = []
  settingsState.customCategories = { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }
  settingsState.settings = { theme: 'dark', accent: '#6366f1', hideAmounts: false, currency: 'EUR', budgetAlerts: true, alertThreshold: 80 }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('pantalla principal', () => {
  it('muestra cuenta, filas con valor actual, interruptor y cerrar sesión', () => {
    renderPanel()
    expect(screen.getByText('Ana Pérez')).toBeTruthy()
    expect(screen.getByText('ana@x.es')).toBeTruthy()
    for (const n of ['Apariencia', 'Categorías', 'Presupuestos y alertas', 'Pagos automáticos', 'Datos y exportar', 'Ayuda']) {
      expect(within(panel()).getByRole('button', { name: new RegExp(`^${n}`) })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: /^Apariencia\s*Oscuro/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Presupuestos y alertas\s*Al 80%/ })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Ocultar importes' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy()
    // es corta: ninguna lista de categorías ni botones «Eliminar» en la principal
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull()
  })

  it('ocultar importes se cambia desde la principal', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('switch', { name: 'Ocultar importes' }))
    expect(settingsState.update).toHaveBeenCalledWith('hideAmounts', true)
  })

  it('cerrar sesión pide confirmación', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(logout).not.toHaveBeenCalled()
    const dlg = screen.getByRole('dialog', { name: '¿Cerrar sesión?' })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancelar' }))
    expect(logout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '¿Cerrar sesión?' })).getByRole('button', { name: 'Cerrar sesión' }))
    expect(logout).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('Pagos automáticos abre la guía del Atajo', async () => {
    renderPanel()
    goTo('Pagos automáticos')
    expect(await screen.findByRole('dialog', { name: 'Guía del Atajo' })).toBeTruthy()
  })
})

describe('navegación', () => {
  it.each([
    ['Apariencia', 'Apariencia'], ['Categorías', 'Categorías'], ['Presupuestos y alertas', 'Presupuestos y alertas'],
    ['Datos y exportar', 'Datos y exportar'], ['Ayuda', 'Ayuda'],
  ])('«%s» abre su subpantalla y Atrás vuelve devolviendo el foco a la fila', (row, t) => {
    renderPanel()
    goTo(row)
    expect(title()).toBe(t)
    expect(screen.queryByRole('switch', { name: 'Ocultar importes' })).toBeNull()
    back()
    expect(title()).toBe('Perfil y ajustes')
    expect(document.activeElement).toBe(within(panel()).getByRole('button', { name: new RegExp(`^${row}`) }))
  })

  it('Escape vuelve a la principal y, estando en ella, cierra el panel', () => {
    renderPanel()
    goTo('Ayuda')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(title()).toBe('Perfil y ajustes')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('el botón de la barra cierra en la principal y vuelve en una subpantalla', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar perfil y ajustes' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('deslizar a la derecha vuelve atrás', () => {
    renderPanel()
    goTo('Datos y exportar')
    fireEvent.touchStart(panel(), { touches: [{ clientX: 10, clientY: 100 }] })
    fireEvent.touchEnd(panel(), { changedTouches: [{ clientX: 160, clientY: 105 }] })
    expect(title()).toBe('Perfil y ajustes')
  })
})

describe('panel cerrado', () => {
  it('queda fuera del árbol de accesibilidad y del Tab; abierto, el fondo es inerte', () => {
    const { rerender, container } = renderPanel(false)
    const el = container.querySelector('.profile-screen')
    expect(el.hasAttribute('inert')).toBe(true)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('dialog', { name: 'Perfil y ajustes' })).toBeNull()
    rerender(<ProfilePanel open onClose={onClose} onShowGuide={onShowGuide} />)
    expect(el.hasAttribute('inert')).toBe(false)
    expect(el.hasAttribute('aria-hidden')).toBe(false)
  })
})

describe('funciones del inventario', () => {
  it('Apariencia: tema, acento, moneda con su nota', () => {
    renderPanel(); goTo('Apariencia')
    fireEvent.click(screen.getByRole('button', { name: 'Tema Bosque' }))
    expect(settingsState.update).toHaveBeenCalledWith('theme', 'forest')
    expect(screen.getAllByRole('button', { name: /^Tema / })).toHaveLength(8)
    fireEvent.click(screen.getAllByRole('button', { name: /^Color / })[1])
    expect(settingsState.update).toHaveBeenCalledWith('accent', expect.any(String))
    fireEvent.click(screen.getByRole('button', { name: 'Libra' }))
    expect(settingsState.update).toHaveBeenCalledWith('currency', 'GBP')
    expect(screen.getByText('Solo cambia el símbolo; no convierte importes.')).toBeTruthy()
  })

  it('Presupuestos y alertas: interruptor y deslizador con nombre; borrar con confirmación', () => {
    renderPanel(); goTo('Presupuestos y alertas')
    fireEvent.click(screen.getByRole('switch', { name: 'Alertas de gasto' }))
    expect(settingsState.update).toHaveBeenCalledWith('budgetAlerts', false)
    const slider = screen.getByRole('slider', { name: 'Umbral de alerta' })
    fireEvent.change(slider, { target: { value: '90' } })
    expect(settingsState.update).toHaveBeenCalledWith('alertThreshold', 90)
    fireEvent.click(screen.getByRole('button', { name: 'Borrar presupuesto' }))
    expect(removeItem).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog', { name: '¿Borrar el presupuesto?' })).getByRole('button', { name: 'Borrar presupuesto' }))
    expect(removeItem).toHaveBeenCalledTimes(2)
  })

  it('Categorías: eliminar una propia pide confirmación; nueva categoría abre el formulario', () => {
    settingsState.customCategories = { ...settingsState.customCategories, 'Gasto Variable': [{ concepto: 'Mascotas', emoji: '🐾' }] }
    renderPanel(); goTo('Categorías')
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar la categoría Mascotas' }))
    expect(settingsState.removeCategory).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog', { name: /Eliminar la categoría/ })).getByRole('button', { name: 'Eliminar' }))
    expect(settingsState.removeCategory).toHaveBeenCalledWith('Gasto Variable', 'Mascotas')
    fireEvent.click(screen.getByRole('button', { name: /nueva categoría/i }))
    expect(screen.getByRole('dialog', { name: 'Nueva categoría' })).toBeTruthy()
    // Escape cierra solo el formulario, no el panel ni la subpantalla
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Nueva categoría' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(title()).toBe('Categorías')
  })

  it('Categorías: lista larga con búsqueda y «Mostrar más»', () => {
    settingsState.customCategories = { ...settingsState.customCategories,
      'Gasto Variable': Array.from({ length: 25 }, (_, i) => ({ concepto: `Cat ${i + 1}`, emoji: '🐾' })) }
    renderPanel(); goTo('Categorías')
    expect(screen.getAllByRole('button', { name: /^Eliminar la categoría/ })).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: /Mostrar más \(15/ }))
    expect(screen.getAllByRole('button', { name: /^Eliminar la categoría/ })).toHaveLength(20)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar entre mis categorías' }), { target: { value: 'cat 25' } })
    expect(screen.getAllByRole('button', { name: /^Eliminar la categoría/ })).toHaveLength(1)
  })

  it('Categorías por defecto: grupos plegables, ocultar, contador y mostrar todas', () => {
    settingsState.hiddenCategories = [{ tipo: 'Gasto Variable', concepto: 'Ocio' }]
    renderPanel(); goTo('Categorías')
    expect(screen.getByText('1 oculta', { selector: '.s-value-text' })).toBeTruthy()
    const group = screen.getByRole('button', { name: /Gastos variables/ })
    expect(group.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Ocultar la categoría Gimnasio' })).toBeNull()
    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar la categoría Gimnasio' }))
    expect(setHiddenCategories).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todas' }))
    expect(setHiddenCategories).toHaveBeenLastCalledWith([])
  })

  it('Datos: exportar JSON, CSV e informe mensual', async () => {
    exportMocks.fetchAllTransactions.mockResolvedValue({ transactions: [], years: [2025], unreadable: 0 })
    exportMocks.fetchExtras.mockResolvedValue({})
    apiMocks.sendMonthlyReport.mockResolvedValue({})
    renderPanel(); goTo('Datos y exportar')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar datos (JSON)' }))
    await waitFor(() => expect(exportMocks.downloadText).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exportar movimientos en CSV' }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar movimientos en CSV' }))
    await waitFor(() => expect(exportMocks.downloadText).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar informe mensual ahora' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('📧 Informe enviado a tu email'))
  })

  it('Ayuda: guía de la app y contacto', () => {
    renderPanel(); goTo('Ayuda')
    fireEvent.click(screen.getByRole('button', { name: 'Ver guía de la app' }))
    expect(onShowGuide).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'soporte@mieconomia.app' }).getAttribute('href')).toMatch(/^mailto:/)
  })

  it('muestra la versión de build', () => {
    renderPanel()
    expect(document.querySelector('.build-marker-inline').textContent).toMatch(/^build /)
  })
})
