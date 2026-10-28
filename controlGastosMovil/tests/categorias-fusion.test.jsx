// Fusión de categorías por defecto + propias sin duplicados, claves únicas en
// los modales y aviso al dar de alta una categoría que ya existe.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import {
  DEFAULT_CATEGORIES, normalizeCategoryName, categoryKey, combineCategories, categoryExists, mergeCategories,
} from '../src/data/categories'

const refresh   = vi.fn()
const showToast = vi.fn()
const settingsState = {
  customCategories: {},
  addCategory: vi.fn(() => true),
  removeCategory: vi.fn(),
  update: vi.fn(),
  settings: { theme: 'dark', accent: '#6366f1', hideAmounts: false, currency: 'EUR', budgetAlerts: true, alertThreshold: 80 },
}

vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ refresh, data: { transactions: [] }, transactions: [] }) }))
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
  postTransaction: vi.fn(async () => ({})),
  suggestEmoji: vi.fn(async () => ({ emoji: '✨' })),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  sendMonthlyReport: vi.fn(),
}))

import { postTransaction } from '../src/services/api'
import AddTransactionModal, { DUPLICATE_CAT_MSG } from '../src/components/ui/AddTransactionModal'
import BudgetModal from '../src/components/ui/BudgetModal'
import CategorizeModal from '../src/components/ui/CategorizeModal'
import TransactionEditModal from '../src/components/ui/TransactionEditModal'
import SettingsTab from '../src/components/tabs/SettingsTab'

// "Gimnasio" ya es por defecto; el usuario además lo tiene como propia, dos
// veces y con distinta forma (mayúsculas, acento, espacios).
const GIM_DUP = {
  'Gasto Variable': [
    { id: '1', tipo: 'Gasto Variable', concepto: 'Gimnasio', emoji: '🏋️' },
    { id: '2', tipo: 'Gasto Variable', concepto: ' gimnásio ', emoji: '🤸' },
  ],
  'Gasto Fijo': [], 'Ingreso': [],
}

let errSpy
beforeEach(() => {
  settingsState.customCategories = { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }
  settingsState.addCategory = vi.fn(() => true)
  errSpy = vi.spyOn(console, 'error')
})
afterEach(() => { cleanup(); vi.clearAllMocks(); errSpy.mockRestore() })

const keyWarnings = () => errSpy.mock.calls.filter(args => args.some(a => /same key/i.test(String(a))))
const gimTiles = () => screen.queryAllByText(/^\s*gimn[aá]sio\s*$/i)

describe('normalización y fusión', () => {
  it('normalizeCategoryName ignora mayúsculas, acentos y espacios', () => {
    expect(normalizeCategoryName('  Gimnásio  ')).toBe('gimnasio')
    expect(normalizeCategoryName('Seguro   COCHE')).toBe('seguro coche')
    expect(normalizeCategoryName('Nómina')).toBe(normalizeCategoryName('nomina'))
    expect(normalizeCategoryName(null)).toBe('')
    expect(normalizeCategoryName(undefined)).toBe('')
  })

  it('categoryKey es única por tipo y nombre normalizado', () => {
    expect(categoryKey('Gasto Variable', 'Gimnasio')).toBe(categoryKey('Gasto Variable', ' gimnásio'))
    expect(categoryKey('Gasto Variable', 'Gimnasio')).not.toBe(categoryKey('Gasto Fijo', 'Gimnasio'))
  })

  it('combineCategories: una propia igual a una por defecto se muestra una vez, con el nombre por defecto y el emoji propio', () => {
    const out = combineCategories(DEFAULT_CATEGORIES['Gasto Variable'], GIM_DUP['Gasto Variable'])
    const gims = out.filter(c => normalizeCategoryName(c.concepto) === 'gimnasio')
    expect(gims).toHaveLength(1)
    expect(gims[0].concepto).toBe('Gimnasio')
    expect(gims[0].emoji).toBe('🏋️')
    expect(out).toHaveLength(DEFAULT_CATEGORIES['Gasto Variable'].length)
    // no muta las por defecto
    expect(DEFAULT_CATEGORIES['Gasto Variable'].find(c => c.concepto === 'Gimnasio').emoji).toBe('💪')
  })

  it('combineCategories: propias repetidas entre sí y vacías no se duplican; el orden se conserva', () => {
    const out = combineCategories([], [
      { concepto: 'Clínica', emoji: 'a' }, { concepto: 'clinica', emoji: 'b' }, { concepto: '   ' }, { concepto: 'Libros', emoji: 'c' },
    ])
    expect(out.map(c => c.concepto)).toEqual(['Clínica', 'Libros'])
    expect(out[0].emoji).toBe('a')
  })

  it('combineCategories acepta listas ausentes', () => {
    expect(combineCategories(undefined, undefined)).toEqual([])
    expect(combineCategories(null, [{ concepto: 'X' }])).toEqual([{ concepto: 'X' }])
  })

  it('categoryExists compara por nombre normalizado y nunca da por existente un nombre vacío', () => {
    const list = DEFAULT_CATEGORIES['Gasto Variable']
    expect(categoryExists(list, '  GIMNÁSIO ')).toBe(true)
    expect(categoryExists(list, 'Clínica')).toBe(false)
    expect(categoryExists(list, '  ')).toBe(false)
    expect(categoryExists(null, 'Ocio')).toBe(false)
  })

  it('mergeCategories oculta por nombre normalizado y fusiona propias sin duplicar', () => {
    const merged = mergeCategories(GIM_DUP, [{ tipo: 'Gasto Variable', concepto: 'ocio' }])
    const names = merged['Gasto Variable'].map(c => c.concepto)
    expect(names).not.toContain('Ocio')
    expect(names.filter(n => normalizeCategoryName(n) === 'gimnasio')).toEqual(['Gimnasio'])
  })
})

describe('un solo "Gimnasio" y sin claves duplicadas en los cuatro modales', () => {
  beforeEach(() => { settingsState.customCategories = GIM_DUP })

  it('AddTransactionModal', () => {
    render(<AddTransactionModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Gasto Variable'))
    expect(gimTiles()).toHaveLength(1)
    expect(keyWarnings()).toEqual([])
  })

  it('BudgetModal', () => {
    render(<BudgetModal onSave={vi.fn()} onClose={vi.fn()} />)
    expect(gimTiles()).toHaveLength(1)
    expect(keyWarnings()).toEqual([])
  })

  it('CategorizeModal', () => {
    render(<CategorizeModal pending={{ id: 1, importe: 30, fecha: '2026-10-10' }} total={1}
      onCategorize={vi.fn()} onSkip={vi.fn()} onDiscard={vi.fn()} />)
    fireEvent.click(screen.getByText('Gasto Variable'))
    expect(gimTiles()).toHaveLength(1)
    expect(keyWarnings()).toEqual([])
  })

  it('TransactionEditModal (movimiento guardado con otra forma del nombre: no se añade otra tarjeta)', () => {
    const tx = { rowIndex: 3, fecha: '2026-10-02', importe: 30, concepto: 'gimnasio', bucket: 'variableExpenses', comentario: '' }
    render(<TransactionEditModal tx={tx} emoji="💪" onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    const group = screen.getByRole('radiogroup', { name: 'Categoría' })
    const gims = within(group).getAllByRole('radio').filter(b => /gimn[aá]sio/i.test(b.textContent))
    expect(gims).toHaveLength(1)
    expect(gims[0].getAttribute('aria-checked')).toBe('true')
    expect(keyWarnings()).toEqual([])
  })
})

describe('alta de una categoría repetida', () => {
  function openNewCat() {
    render(<AddTransactionModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Gasto Variable'))
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /nueva categoría/i }))
  }
  const typeName = (v) => fireEvent.change(screen.getByLabelText('Nombre de la categoría'), { target: { value: v } })
  const alertText = () => screen.getAllByRole('alert').map(a => a.textContent).join(' ')

  it('con el nombre de una por defecto (otra forma) avisa y no crea ni guarda nada', () => {
    openNewCat()
    typeName('  GIMNÁSIO ')
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(alertText()).toContain(DUPLICATE_CAT_MSG)
    expect(settingsState.addCategory).not.toHaveBeenCalled()
    expect(postTransaction).not.toHaveBeenCalled()
  })

  it('con el nombre de una propia ya existente también avisa', () => {
    settingsState.customCategories = { ...settingsState.customCategories, 'Gasto Variable': [{ id: '9', tipo: 'Gasto Variable', concepto: 'Clínica', emoji: '🏥' }] }
    openNewCat()
    typeName('clinica')
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(alertText()).toContain(DUPLICATE_CAT_MSG)
    expect(settingsState.addCategory).not.toHaveBeenCalled()
  })

  it('si el contexto la rechaza (addCategory → false) avisa y no guarda el movimiento', () => {
    settingsState.addCategory = vi.fn(() => false)
    openNewCat()
    typeName('Mascotas')
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(alertText()).toContain(DUPLICATE_CAT_MSG)
    expect(postTransaction).not.toHaveBeenCalled()
  })

  it('una nueva de verdad se crea y queda elegida, sin guardar el movimiento', () => {
    openNewCat()
    typeName('Mascotas')
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(settingsState.addCategory).toHaveBeenCalledWith('Gasto Variable', { concepto: 'Mascotas', emoji: '💶' })
    expect(postTransaction).not.toHaveBeenCalled()
  })
})

describe('Ajustes: categorías personalizadas', () => {
  it('lista también las de Ingreso, con su etiqueta', () => {
    settingsState.customCategories = {
      'Gasto Variable': [{ id: '1', tipo: 'Gasto Variable', concepto: 'Clínica', emoji: '🏥' }],
      'Gasto Fijo': [],
      'Ingreso': [{ id: '2', tipo: 'Ingreso', concepto: 'Freelance', emoji: '💻' }],
    }
    render(<SettingsTab initialScreen="categories" />)
    expect(screen.getByText('Freelance')).toBeTruthy()
    expect(screen.getByText('Ingreso')).toBeTruthy()
    expect(screen.getByText('Clínica')).toBeTruthy()
    expect(screen.queryByText(/Aún no has creado ninguna/)).toBeNull()
  })

  it('solo con propias de Ingreso ya no dice que no hay ninguna', () => {
    settingsState.customCategories = { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [{ id: '2', tipo: 'Ingreso', concepto: 'Freelance', emoji: '💻' }] }
    render(<SettingsTab initialScreen="categories" />)
    expect(screen.queryByText(/Aún no has creado ninguna/)).toBeNull()
    expect(screen.getByText('Freelance')).toBeTruthy()
  })

  it('nombres repetidos en la lista no provocan claves duplicadas', () => {
    settingsState.customCategories = GIM_DUP
    render(<SettingsTab initialScreen="categories" />)
    expect(keyWarnings()).toEqual([])
  })
})
