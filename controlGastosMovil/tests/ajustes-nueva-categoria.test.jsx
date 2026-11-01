// Ajustes: crear una categoría propia sin añadir ningún gasto.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { useReducer } from 'react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const showToast = vi.fn()
let bump = () => {}
const settingsState = {
  customCategories: { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] },
  addCategory: vi.fn(),
  removeCategory: vi.fn(),
  update: vi.fn(),
  settings: { theme: 'dark', accent: '#6366f1', hideAmounts: false, currency: 'EUR', budgetAlerts: true, alertThreshold: 80 },
}

vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast }) }))
vi.mock('../src/context/SettingsContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useSettings: () => settingsState,
}))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
vi.mock('../src/hooks/useBudget', async (importOriginal) => ({
  ...(await importOriginal()),
  useBudget: () => ({ allItems: [], removeItem: vi.fn() }),
}))
vi.mock('../src/services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  suggestEmoji: vi.fn(async () => ({ emoji: '🐶' })),
  sendMonthlyReport: vi.fn(),
}))

import SettingsTab from '../src/components/tabs/SettingsTab'

function Harness() {
  const [, force] = useReducer(x => x + 1, 0)
  bump = force
  return <SettingsTab initialScreen="categories" />
}

beforeEach(() => {
  settingsState.customCategories = { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }
  settingsState.addCategory = vi.fn((tipo, item) => {
    settingsState.customCategories = { ...settingsState.customCategories, [tipo]: [...settingsState.customCategories[tipo], item] }
    act(() => bump())
    return true
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const openForm = () => { render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /nueva categoría/i })) }
const typeName = v => fireEvent.change(screen.getByLabelText('Nombre de la categoría'), { target: { value: v } })
const alertText = () => screen.getAllByRole('alert').map(a => a.textContent).join(' ')

describe('Ajustes: nueva categoría', () => {
  it('el texto vacío ya no menciona «+ Nueva»', () => {
    render(<Harness />)
    expect(screen.getByText(/Aún no has creado ninguna/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('"+ Nueva"')
  })

  it('abre el formulario con diálogo y los tres tipos', () => {
    openForm()
    expect(screen.getByRole('dialog', { name: 'Nueva categoría' })).toBeTruthy()
    expect(screen.getAllByRole('radio', { name: /Gasto Variable|Gasto Fijo|Ingreso/ })).toHaveLength(3)
  })

  it('crea la categoría sin gasto, avisa, cierra y la lista', () => {
    openForm()
    fireEvent.click(screen.getByRole('radio', { name: 'Ingreso' }))
    fireEvent.click(screen.getByRole('radio', { name: '🐾' }))
    typeName('  Bizum  ')
    fireEvent.click(screen.getByRole('button', { name: 'Crear categoría' }))
    expect(settingsState.addCategory).toHaveBeenCalledWith('Ingreso', { concepto: 'Bizum', emoji: '🐾' })
    expect(showToast).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Bizum')).toBeTruthy()
  })

  it('rechaza el nombre vacío', () => {
    openForm()
    typeName('   ')
    fireEvent.click(screen.getByRole('button', { name: 'Crear categoría' }))
    expect(alertText()).toContain('Escribe un nombre')
    expect(settingsState.addCategory).not.toHaveBeenCalled()
  })

  it('rechaza un duplicado de una por defecto', () => {
    openForm()
    typeName('  GIMNÁSIO ')
    fireEvent.click(screen.getByRole('button', { name: 'Crear categoría' }))
    expect(alertText()).toContain('Ya existe una categoría con ese nombre')
    expect(settingsState.addCategory).not.toHaveBeenCalled()
  })

  it('si el contexto la rechaza (false) avisa y no cierra', () => {
    settingsState.addCategory = vi.fn(() => false)
    openForm()
    typeName('Mascotas')
    fireEvent.click(screen.getByRole('button', { name: 'Crear categoría' }))
    expect(alertText()).toContain('Ya existe')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('Escape cierra sin crear nada', () => {
    openForm()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(settingsState.addCategory).not.toHaveBeenCalled()
  })

  it('al cerrar con Escape o con Volver el foco vuelve al botón que abrió el formulario', async () => {
    openForm()
    const btn = screen.getByRole('button', { name: /nueva categoría/i })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(btn))
    fireEvent.click(btn)
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    await waitFor(() => expect(document.activeElement).toBe(btn))
  })

  it('avisa al llegar al límite de 32 caracteres', () => {
    openForm()
    typeName('A'.repeat(31))
    expect(screen.queryByText(/32\/32/)).toBeNull()
    typeName('A'.repeat(32))
    expect(screen.getByText(/32\/32 caracteres/)).toBeTruthy()
  })

  it('la fila de una categoría de nombre largo marca la etiqueta como encogible', () => {
    settingsState.customCategories = { ...settingsState.customCategories, 'Gasto Variable': [{ concepto: 'A'.repeat(32), emoji: '🐾' }] }
    render(<Harness />)
    expect(document.querySelector('.pf-cat-name')).toBeTruthy()
  })
})
