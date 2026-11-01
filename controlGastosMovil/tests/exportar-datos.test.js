// Exportación: CSV (escapado, inyección de fórmulas, Excel español) y JSON completo.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/services/api', () => ({
  fetchFinanceData: vi.fn(),
  fetchFinanceYear: vi.fn(),
  fetchGoals: vi.fn(),
  fetchAnnualExpenses: vi.fn(),
}))
import * as api from '../src/services/api'
import {
  csvCell, csvAmount, buildCsv, buildExportPayload, fetchAllTransactions, fetchExtras, exportErrorMessage,
} from '../src/utils/exportData'

beforeEach(() => vi.clearAllMocks())

describe('CSV', () => {
  it('celdas: comillas, separador y saltos de línea', () => {
    expect(csvCell('hola')).toBe('hola')
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('dice "hola"')).toBe('"dice ""hola"""')
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"')
    expect(csvCell(null)).toBe('')
  })
  it('protege contra inyección de fórmulas', () => {
    for (const c of ['=SUMA(A1)', '+1', '-1', '@x', '\t=1']) expect(csvCell(c).startsWith("'")).toBe(true)
    expect(csvCell('=1;2')).toBe(`"'=1;2"`)
    expect(csvCell('a=b')).toBe('a=b')
  })
  it('importes con coma decimal', () => {
    expect(csvAmount(12.5)).toBe('12,50')
    expect(csvAmount(1234)).toBe('1234,00')
    expect(csvAmount('x')).toBe('')
  })
  it('buildCsv: BOM, cabecera, ; y orden por fecha', () => {
    const csv = buildCsv([
      { fecha: '2025-03-02', bucket: 'variableExpenses', concepto: 'Comida', importe: 9.9, comentario: 'cena; con "amigos"', rowIndex: 2 },
      { fecha: '2024-12-31', bucket: 'income', concepto: '=HYPERLINK("x")', importe: 100, comentario: '', rowIndex: 1 },
    ])
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('fecha;tipo;concepto;importe;comentario')
    expect(lines[1]).toBe(`2024-12-31;Ingreso;"'=HYPERLINK(""x"")";100,00;`)
    expect(lines[2]).toBe('2025-03-02;Gasto Variable;Comida;9,90;"cena; con ""amigos"""')
  })
})

describe('recogida de movimientos de todos los años', () => {
  it('pide cada año y junta sin duplicados', async () => {
    api.fetchFinanceYear.mockImplementation(async y => ({
      unreadable: y === 2024 ? 1 : 0,
      transactions: [{ rowIndex: y, fecha: `${y}-01-01`, concepto: 'A', importe: 1, bucket: 'income' }, { rowIndex: 1, fecha: '2023-01-01', concepto: 'dup', importe: 1 }],
    }))
    const r = await fetchAllTransactions([2024, 2023])
    expect(api.fetchFinanceYear.mock.calls.map(c => c[0])).toEqual([2023, 2024])
    expect(r.transactions.map(t => t.rowIndex)).toEqual([2023, 1, 2024])
    expect(r.unreadable).toBe(1)
  })
  it('sin años conocidos los consulta al servidor', async () => {
    api.fetchFinanceData.mockResolvedValue({ availableYears: [2025] })
    api.fetchFinanceYear.mockResolvedValue({ transactions: [] })
    const r = await fetchAllTransactions(undefined)
    expect(r.years).toEqual([2025])
    expect(api.fetchFinanceYear).toHaveBeenCalledWith(2025)
  })
  it('si falla un año, lanza', async () => {
    api.fetchFinanceYear.mockRejectedValue(new TypeError('network'))
    await expect(fetchAllTransactions([2025])).rejects.toThrow()
  })
  it('mensaje claro de error', () => {
    expect(exportErrorMessage(new TypeError('x'))).toMatch(/despertando/)
    expect(exportErrorMessage(Object.assign(new Error('boom'), { status: 500 }))).toMatch(/despertando/)
    expect(exportErrorMessage(Object.assign(new Error('mal'), { status: 400 }))).toMatch(/mal/)
  })
})

describe('JSON', () => {
  it('incluye movimientos, metas y gastos anuales; anota lo que falta', async () => {
    api.fetchGoals.mockResolvedValue([{ id: 1 }])
    api.fetchAnnualExpenses.mockRejectedValue(new Error('x'))
    const extras = await fetchExtras()
    const p = buildExportPayload({
      budget: [], settings: { currency: 'USD' }, hiddenCategories: [{ tipo: 'Ingreso', concepto: 'Nómina' }],
      transactions: [{ fecha: '2025-01-01', bucket: 'fixedExpenses', concepto: 'Luz', importe: 40 }],
      years: [2025], unreadable: 2, ...extras, now: new Date('2025-02-01T00:00:00Z'),
    })
    expect(p.transactions).toEqual([{ fecha: '2025-01-01', tipo: 'Gasto Fijo', concepto: 'Luz', importe: 40, comentario: '' }])
    expect(p.goals).toEqual([{ id: 1 }])
    expect(p.notExported).toEqual(['annualExpenses'])
    expect(p.unreadableTransactions).toBe(2)
    expect(p.hiddenCategories).toHaveLength(1)
  })
})
