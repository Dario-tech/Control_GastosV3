// Render de la pantalla Estadísticas: secciones, estados vacíos, sin texto generado y «Ocultar importes».
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }

let finance
let hideAmounts = false
const NOW = new Date(2026, 9, 28, 10)

vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ data: finance }) }))
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ selectedMonth: 9, selectedYear: 2026 }) }))
vi.mock('../src/context/SettingsContext', () => ({
  useSettings: () => ({ settings: { hideAmounts, theme: 'dark' }, budgetItems: [], updateBudgets: () => {} }),
}))
vi.mock('../src/hooks/useBudget', () => ({ useBudget: () => ({ itemsForMonth: () => [{ id: 1, name: 'Comida', limit: 400, month: 9 }] }) }))
vi.mock('../src/hooks/useRecurring', () => ({
  useRecurring: () => ({
    status: 'ready',
    items: [
      { concepto: 'Nómina', importe: 2000, frecuencia: 'mensual', ultima: '2026-10-01', proxima: '2026-11-01' },
      { concepto: 'Netflix', importe: 12, frecuencia: 'mensual', ultima: '2026-10-15', proxima: '2026-11-14' },
    ],
  }),
}))
vi.mock('../src/hooks/useAnnualExpenses', () => ({ useAnnualExpenses: () => ({ expenses: [{ nombre: 'IBI', importe: 250, mes: 11, dia: 10 }] }) }))

import StatsTab from '../src/components/tabs/StatsTab'

const tx = (fecha, concepto, importe, bucket = 'variableExpenses') => ({ fecha, concepto, importe, bucket })
const full = () => ({
  year: 2026, activeMonths: Array(12).fill(true), income: [], fixedExpenses: [], variableExpenses: [],
  transactions: [
    tx('2026-10-01', 'Nómina', 2000, 'income'), tx('2026-10-01', 'Piso', 600, 'fixedExpenses'),
    tx('2026-10-10', 'Comida', 150), tx('2026-10-15', 'Netflix', 12),
    tx('2026-09-01', 'Nómina', 2000, 'income'), tx('2026-09-01', 'Piso', 600, 'fixedExpenses'), tx('2026-09-10', 'Comida', 100),
  ],
})

afterEach(() => { cleanup(); hideAmounts = false; vi.useRealTimers() })

function renderStats(data) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  finance = data
  return render(<StatsTab />)
}

describe('StatsTab', () => {
  it('cuenta nueva: un único estado vacío claro', () => {
    renderStats({ year: 2026, activeMonths: Array(12).fill(false), income: [], fixedExpenses: [], variableExpenses: [], transactions: [] })
    expect(screen.getByText(/Todavía no hay movimientos/)).toBeTruthy()
    expect(screen.queryByText('Este mes')).toBeNull()
  })

  it('muestra las secciones con títulos h2 y sin frases generadas', () => {
    const { container } = renderStats(full())
    const titles = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(titles).toEqual([
      'Este mes', 'Cierre previsto', 'Por encima de lo habitual', 'Dónde va el dinero', 'Fijos · variables · ahorro',
      'Últimos 6 meses', 'Cuándo gastas', 'Próximos cargos',
    ])
    expect(container.textContent).not.toMatch(/Resumen del mes|Gastaste|sobre todo en|Suscripciones detectadas/)
  })

  it('compara el mismo tramo y usa el presupuesto', () => {
    renderStats(full())
    const sec = screen.getByRole('heading', { name: 'Este mes' }).closest('section')
    expect(sec.textContent).toMatch(/Gastado hasta el día 28/)
    expect(sec.textContent).toMatch(/septiembre, días 1–28/)
    expect(sec.textContent).toMatch(/Margen diario/)
    expect(within(sec).getByRole('progressbar')).toBeTruthy()
  })

  it('próximos cargos: sin nómina y con el gasto anual', () => {
    renderStats(full())
    const sec = screen.getByRole('heading', { name: 'Próximos cargos' }).closest('section')
    expect(sec.textContent).toMatch(/Netflix/)
    expect(sec.textContent).toMatch(/IBI/)
    expect(sec.textContent).not.toMatch(/Nómina/)
  })

  it('«por encima de lo habitual» pide 3 meses de historial', () => {
    renderStats(full())
    expect(screen.getByText(/Hacen falta al menos 3 meses/)).toBeTruthy()
  })

  it('el gráfico tiene role=img con resumen en español y una tabla accesible', () => {
    renderStats(full())
    const img = screen.getAllByRole('img').find(e => /Ingresos y gastos por mes/.test(e.getAttribute('aria-label')))
    expect(img.getAttribute('aria-label')).toMatch(/Octubre \(en curso\)/)
    expect(screen.getByRole('table', { hidden: true })).toBeTruthy()
  })

  it('un solo mes de datos: lo que hay, sin inventar tendencias', () => {
    renderStats({ ...full(), transactions: [tx('2026-10-01', 'Nómina', 2000, 'income'), tx('2026-10-10', 'Comida', 150)] })
    expect(screen.getByText(/Sin movimientos en septiembre para comparar/)).toBeTruthy()
    expect(screen.getByText(/Solo hay un mes con datos/)).toBeTruthy()
  })

  it('las cifras van dentro de .amt para «Ocultar importes»', () => {
    const { container } = renderStats(full())
    expect(container.querySelectorAll('.amt').length).toBeGreaterThan(10)
  })
})
