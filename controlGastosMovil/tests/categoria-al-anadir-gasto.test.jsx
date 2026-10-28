// Crear una categoría sin salir del formulario: añadir gasto, editar movimiento y categorizar pendiente.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

const refresh = vi.fn()
const settingsState = {
  customCategories: { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] },
  addCategory: vi.fn(() => true),
  settings: { theme: 'dark', accent: '#6366f1', hideAmounts: false, currency: 'EUR' },
}

vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ refresh, data: { transactions: [] }, transactions: [] }) }))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast: vi.fn() }) }))
vi.mock('../src/context/SettingsContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useSettings: () => settingsState,
}))
vi.mock('../src/hooks/useCategories', () => ({ useCategories: () => DEFAULT_CATEGORIES }))
vi.mock('../src/services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  postTransaction: vi.fn(async () => ({})),
  suggestEmoji: vi.fn(async () => ({ emoji: '🐶' })),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))

import { postTransaction } from '../src/services/api'
import AddTransactionModal from '../src/components/ui/AddTransactionModal'
import CategorizeModal from '../src/components/ui/CategorizeModal'
import TransactionEditModal from '../src/components/ui/TransactionEditModal'

beforeEach(() => {
  settingsState.customCategories = { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }
  settingsState.addCategory = vi.fn(() => true)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const openBtn = () => screen.getByRole('button', { name: /nueva categoría/i })
const nameInput = () => screen.getByLabelText('Nombre de la categoría')
const typeName = v => fireEvent.change(nameInput(), { target: { value: v } })
const create = (label = 'Crear') => fireEvent.click(screen.getByRole('button', { name: label }))
const alertText = () => screen.queryAllByRole('alert').map(a => a.textContent).join(' ')
const sheet = () => screen.queryByRole('dialog', { name: 'Nueva categoría' })

function openAdd() {
  render(<AddTransactionModal onClose={vi.fn()} />)
  fireEvent.click(screen.getByText('Gasto Variable'))
}
// Tras crear, la categoría pasa a existir en el contexto (como hace addCategory optimista).
function makeAddRealistic() {
  settingsState.addCategory = vi.fn((tipo, item) => {
    settingsState.customCategories = { ...settingsState.customCategories, [tipo]: [...settingsState.customCategories[tipo], { id: 'x', tipo, ...item }] }
    return true
  })
}

describe('añadir gasto: nueva categoría en la hoja', () => {
  it('con importe vacío: crea, selecciona, no guarda y no muestra error de importe', () => {
    makeAddRealistic()
    openAdd()
    fireEvent.click(openBtn())
    const dlg = sheet()
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(nameInput())
    expect(within(dlg).getByText('Gasto Variable')).toBeTruthy()
    typeName('  Mascotas ')
    create()
    expect(settingsState.addCategory).toHaveBeenCalledWith('Gasto Variable', { concepto: 'Mascotas', emoji: '💶' })
    expect(sheet()).toBeNull()
    expect(alertText()).not.toContain('importe válido')
    expect(postTransaction).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: /Mascotas/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: /Guardar movimiento/ }).disabled).toBe(true)
    expect(document.activeElement).toBe(openBtn())
  })

  it('con importe y comentario: los conserva, habilita Guardar y no guarda solo', async () => {
    makeAddRealistic()
    openAdd()
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '12,5' } })
    fireEvent.change(screen.getByPlaceholderText('Añade una nota…'), { target: { value: 'pienso' } })
    fireEvent.click(openBtn())
    typeName('Mascotas')
    create()
    expect(postTransaction).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('0,00').value).toBe('12,5')
    expect(screen.getByPlaceholderText('Añade una nota…').value).toBe('pienso')
    const save = screen.getByRole('button', { name: /Guardar/ })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await vi.waitFor(() => expect(postTransaction).toHaveBeenCalledTimes(1))
    expect(postTransaction.mock.calls[0].slice(0, 5)).toEqual([12.5, 'Gasto Variable', 'Mascotas', expect.any(String), 'pienso'])
  })

  it('duplicado (mayúsculas y acentos): avisa, no crea y ofrece usar la existente', () => {
    openAdd()
    fireEvent.click(openBtn())
    typeName('  GIMNÁSIO ')
    create()
    expect(alertText()).toContain('Ya existe una categoría con ese nombre')
    expect(settingsState.addCategory).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Usar «Gimnasio»/ }))
    expect(sheet()).toBeNull()
    expect(screen.getByRole('radio', { name: /Gimnasio/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('nombre vacío: avisa y no cierra', () => {
    openAdd()
    fireEvent.click(openBtn())
    create()
    expect(alertText()).toContain('Escribe un nombre')
    expect(sheet()).toBeTruthy()
    expect(settingsState.addCategory).not.toHaveBeenCalled()
  })

  it('Escape cierra la hoja sin perder lo escrito ni cerrar el formulario', () => {
    openAdd()
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '7' } })
    fireEvent.click(openBtn())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(sheet()).toBeNull()
    expect(screen.getByPlaceholderText('0,00').value).toBe('7')
    expect(document.activeElement).toBe(openBtn())
  })
})

describe('editar movimiento y categorizar', () => {
  it('editar: crea y deja la categoría elegida sin guardar', () => {
    makeAddRealistic()
    const tx = { rowIndex: 3, tipo: 'Gasto Variable', concepto: 'Gimnasio', importe: 20, fecha: '2026-10-10', comentario: '' }
    render(<TransactionEditModal tx={tx} emoji="🏋️" onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    fireEvent.click(openBtn())
    typeName('Mascotas')
    create()
    expect(settingsState.addCategory).toHaveBeenCalledWith('Gasto Variable', { concepto: 'Mascotas', emoji: '💶' })
    expect(screen.getByRole('radio', { name: /Mascotas/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'Guardar cambios' }).disabled).toBe(false)
  })

  it('categorizar: crea y categoriza el pendiente con la nueva', () => {
    makeAddRealistic()
    const onCategorize = vi.fn(async () => {})
    render(<CategorizeModal pending={{ id: 7, importe: 30, fecha: '2026-10-10' }} total={1}
      onCategorize={onCategorize} onSkip={vi.fn()} onDiscard={vi.fn()} />)
    fireEvent.click(screen.getByText('Gasto Variable'))
    fireEvent.click(openBtn())
    typeName('Mascotas')
    create('Crear y categorizar')
    expect(onCategorize).toHaveBeenCalledWith(7, 'Gasto Variable', 'Mascotas', { recordar: true })
  })
})
