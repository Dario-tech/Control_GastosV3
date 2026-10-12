import { describe, it, expect } from 'vitest'
import {
  filterCategoryMonth, groupByDay, summarize, prevMonthOf, dayLabel,
  draftFromTx, validateDraft, buildTransactionPatch, applyUpdate, bucketToTipo, parseAmount,
} from '../src/utils/txlog'

const tx = (rowIndex, fecha, importe, extra = {}) => ({
  rowIndex, fecha, importe, concepto: 'Ocio', bucket: 'variableExpenses',
  month: parseInt(fecha.slice(5, 7), 10) - 1, comentario: '', ...extra,
})

const TXS = [
  tx(1, '2026-10-02', 10),
  tx(2, '2026-10-11', 111, { comentario: 'Concierto' }),
  tx(3, '2026-10-11', 21),
  tx(4, '2026-10-05', 5, { concepto: 'Comida' }),
  tx(5, '2025-10-07', 99),          // otro año
  tx(6, '2026-09-20', 50),
  tx(7, '2026-09-21', 50),
]

describe('filterCategoryMonth', () => {
  it('filtra por concepto, mes y año y ordena del más reciente al más antiguo', () => {
    const rows = filterCategoryMonth(TXS, 'Ocio', 9, 2026)
    expect(rows.map(r => r.rowIndex)).toEqual([3, 2, 1])
  })
  it('sin año no filtra por año', () => {
    expect(filterCategoryMonth(TXS, 'Ocio', 9, null)).toHaveLength(4)
  })
})

describe('groupByDay', () => {
  it('agrupa días consecutivos y suma el total del día', () => {
    const groups = groupByDay(filterCategoryMonth(TXS, 'Ocio', 9, 2026))
    expect(groups.map(g => g.fecha)).toEqual(['2026-10-11', '2026-10-02'])
    expect(groups[0].items).toHaveLength(2)
    expect(groups[0].total).toBe(132)
  })
  it('lista vacía → sin grupos', () => {
    expect(groupByDay([])).toEqual([])
  })
})

describe('summarize', () => {
  it('total, nº, media y comparación con el mes anterior', () => {
    const rows = filterCategoryMonth(TXS, 'Ocio', 9, 2026)
    const prev = filterCategoryMonth(TXS, 'Ocio', 8, 2026)
    const s = summarize(rows, prev)
    expect(s.total).toBe(142)
    expect(s.count).toBe(3)
    expect(s.avg).toBeCloseTo(47.33, 2)
    expect(s.prevTotal).toBe(100)
    expect(s.diff).toBe(42)
    expect(s.pct).toBe(42)
  })
  it('sin mes anterior → diff y pct null; sin filas → media 0', () => {
    const s = summarize([], [])
    expect(s).toMatchObject({ total: 0, count: 0, avg: 0, diff: null, pct: null })
  })
})

describe('prevMonthOf / dayLabel', () => {
  it('enero → diciembre del año anterior', () => {
    expect(prevMonthOf(0, 2026)).toEqual({ month: 11, year: 2025 })
    expect(prevMonthOf(5, 2026)).toEqual({ month: 4, year: 2026 })
  })
  it('día de la semana, hoy y ayer', () => {
    expect(dayLabel('2026-10-11', '2026-10-20')).toMatchObject({ day: '11', weekday: 'dom' })
    expect(dayLabel('2026-10-11', '2026-10-20').long).toBe('domingo 11 de octubre')
    expect(dayLabel('2026-10-12', '2026-10-12').weekday).toBe('hoy')
    expect(dayLabel('2026-10-11', '2026-10-12').weekday).toBe('ayer')
  })
})

describe('borrador y PATCH parcial', () => {
  const original = tx(2, '2026-10-11', 111.5, { comentario: 'Concierto' })

  it('draftFromTx deriva el tipo del bucket y formatea el importe con coma', () => {
    expect(draftFromTx(original)).toEqual({
      importe: '111,50', fecha: '2026-10-11', tipo: 'Gasto Variable', concepto: 'Ocio', comentario: 'Concierto',
    })
    expect(bucketToTipo('income')).toBe('Ingreso')
    expect(bucketToTipo('fixedExpenses')).toBe('Gasto Fijo')
  })

  it('sin cambios → objeto vacío (aunque el importe se escriba distinto)', () => {
    const d = draftFromTx(original)
    expect(buildTransactionPatch(original, d)).toEqual({})
    expect(buildTransactionPatch(original, { ...d, importe: '111.5' })).toEqual({})
    expect(buildTransactionPatch(original, { ...d, comentario: '  Concierto ' })).toEqual({})
  })

  it('solo envía los campos cambiados', () => {
    const d = draftFromTx(original)
    expect(buildTransactionPatch(original, { ...d, importe: '20' })).toEqual({ importe: 20 })
    expect(buildTransactionPatch(original, { ...d, fecha: '2026-09-30' })).toEqual({ fecha: '2026-09-30' })
    expect(buildTransactionPatch(original, { ...d, tipo: 'Gasto Fijo', concepto: 'Luz' }))
      .toEqual({ tipo: 'Gasto Fijo', concepto: 'Luz' })
    expect(buildTransactionPatch(original, { ...d, comentario: '' })).toEqual({ comentario: '' })
  })

  it('el importe se envía en positivo aunque sea un ingreso', () => {
    const inc = tx(9, '2026-10-01', 1500, { concepto: 'Nómina', bucket: 'income' })
    const p = buildTransactionPatch(inc, { ...draftFromTx(inc), importe: '1600,25' })
    expect(p).toEqual({ importe: 1600.25 })
  })

  it('validateDraft', () => {
    const d = draftFromTx(original)
    expect(validateDraft(d)).toBe('')
    expect(validateDraft({ ...d, importe: '0' })).toMatch(/importe/)
    expect(validateDraft({ ...d, importe: '' })).toMatch(/importe/)
    expect(validateDraft({ ...d, concepto: null })).toMatch(/categoría/)
    expect(parseAmount('12,5')).toBe(12.5)
  })

  it('applyUpdate recalcula mes y bucket con la respuesta del backend', () => {
    const u = applyUpdate(original, {
      id: 2, fecha: '2026-09-30', tipo: 'Gasto Fijo', concepto: 'Luz', importe: -40, comentario: '',
    })
    expect(u).toMatchObject({ rowIndex: 2, month: 8, concepto: 'Luz', importe: 40, bucket: 'fixedExpenses', comentario: '' })
  })
})
