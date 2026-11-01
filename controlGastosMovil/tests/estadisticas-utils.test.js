// Utilidades puras de Estadísticas (src/utils/stats.js) con datos simulados.
import { describe, it, expect } from 'vitest'
import {
  prepareTransactions, compareSamePeriod, baselineByCategory, categoryBreakdown, categoriesAboveUsual,
  fixedVariableSaving, recentMonths, weekdayAverages, biggestExpense, cleanRecurring, upcomingCharges,
  monthEndForecast, toneOf, niceTicks, percentSplit, budgetUsage, nextAnnualDate,
} from '../src/utils/stats'

const tx = (fecha, concepto, importe, bucket = 'variableExpenses') => ({ fecha, concepto, importe, bucket })
const NOW = new Date(2026, 9, 28, 10) // 28 oct 2026 (octubre: 31 días)
const prepOf = (txs, emojis) => prepareTransactions(txs, emojis)

describe('compareSamePeriod: mismo tramo del mes anterior', () => {
  const prep = prepOf([
    tx('2026-10-05', 'Comida', 100), tx('2026-10-28', 'Ocio', 50), tx('2026-10-30', 'Futuro', 999),
    tx('2026-09-10', 'Comida', 80), tx('2026-09-28', 'Ocio', 20), tx('2026-09-29', 'Comida', 500), tx('2026-09-30', 'Comida', 500),
  ])
  it('compara 1..hoy con 1..hoy del mes anterior (septiembre tiene 30 días)', () => {
    const c = compareSamePeriod(prep, 2026, 9, NOW)
    expect(c.isCurrent).toBe(true)
    expect(c.cutoff).toBe(28)
    expect(c.prevCutoff).toBe(28)
    expect(c.spent).toBe(150)       // el movimiento del 30 aún no ha ocurrido
    expect(c.prevSpent).toBe(100)   // se excluyen los días 29 y 30 de septiembre
    expect(c.delta).toBe(50)
    expect(c.pct).toBe(50)
    expect(c.daysLeft).toBe(3)
  })
  it('el mes anterior más corto limita el tramo (31 de marzo frente a febrero de 28 días)', () => {
    const p = prepOf([tx('2027-03-31', 'A', 100), tx('2027-02-28', 'A', 40), tx('2027-02-10', 'A', 10)])
    const c = compareSamePeriod(p, 2027, 2, new Date(2027, 2, 31))
    expect(c.cutoff).toBe(31)
    expect(c.prevCutoff).toBe(28)
    expect(c.prevSpent).toBe(50)
  })
  it('febrero bisiesto tiene 29 días; abril (30) frente a marzo (31)', () => {
    const p = prepOf([tx('2028-03-31', 'A', 7), tx('2028-02-29', 'A', 5)])
    expect(compareSamePeriod(p, 2028, 2, new Date(2028, 2, 31)).prevCutoff).toBe(29)
    const a = compareSamePeriod(p, 2028, 3, new Date(2028, 3, 30))
    expect(a.prevCutoff).toBe(30)
  })
  it('un mes pasado se compara completo con el anterior completo', () => {
    const c = compareSamePeriod(prep, 2026, 8, NOW)
    expect(c.isCurrent).toBe(false)
    expect(c.cutoff).toBe(30)
    expect(c.spent).toBe(1100)
    expect(c.hasPrev).toBe(false)
    expect(c.delta).toBeNull()
    expect(c.pct).toBeNull()
  })
  it('enero se compara con diciembre del año anterior', () => {
    const p = prepOf([tx('2027-01-03', 'A', 30), tx('2026-12-02', 'A', 60)])
    const c = compareSamePeriod(p, 2027, 0, new Date(2027, 0, 20))
    expect(c.prevMonth).toBe(11)
    expect(c.prevYear).toBe(2026)
    expect(c.delta).toBe(-30)
  })
})

describe('media de los meses anteriores', () => {
  const prep = prepOf([
    tx('2026-07-10', 'Comida', 300), tx('2026-08-10', 'Comida', 200), tx('2026-09-10', 'Comida', 100), tx('2026-09-12', 'Ropa', 60),
    tx('2026-06-10', 'Comida', 9999), // fuera de los 3 meses
  ])
  it('divide entre los meses con gastos y deja fuera el cuarto mes', () => {
    const b = baselineByCategory(prep, 2026, 9, 31)
    expect(b.months).toBe(3)
    expect(b.avg.get('comida')).toBe(200)
    expect(b.avg.get('ropa')).toBe(20)
  })
  it('con un solo mes anterior usa solo ese mes (no inventa)', () => {
    const p = prepOf([tx('2026-09-10', 'Comida', 90)])
    const b = baselineByCategory(p, 2026, 9, 31)
    expect(b.months).toBe(1)
    expect(b.avg.get('comida')).toBe(90)
  })
})

describe('categoryBreakdown', () => {
  const txs = [
    ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((c, i) => tx('2026-10-10', c, 100 - i * 10)),
    tx('2026-09-10', 'A', 50), tx('2026-09-10', 'B', 100),
  ]
  const prep = prepOf(txs, { A: '🍎' })
  it('top 6 + «Otras», porcentaje y variación frente a la media', () => {
    const b = categoryBreakdown(prep, 2026, 9, 28, 6)
    expect(b.items).toHaveLength(7)
    expect(b.items[0]).toMatchObject({ name: 'A', emoji: '🍎', val: 100 })
    expect(b.items[0].change).toEqual({ pct: 100, dir: 'up', tone: 'alert' })
    expect(b.items[1].change).toEqual({ pct: -10, dir: 'down', tone: 'good' })
    expect(b.items.at(-1)).toMatchObject({ name: 'Otras', isOther: true, val: 40 + 30 })
    expect(b.items.reduce((s, i) => s + i.val, 0)).toBe(b.total)
    expect(b.items[2].change).toBeNull() // sin historial de esa categoría
  })
  it('sin meses anteriores no hay variación', () => {
    const b = categoryBreakdown(prepOf([tx('2026-10-10', 'A', 10)]), 2026, 9, 28)
    expect(b.baselineMonths).toBe(0)
    expect(b.items[0].change).toBeNull()
  })
})

describe('categoriesAboveUsual', () => {
  const hist = ['2026-07-05', '2026-08-05', '2026-09-05'].flatMap(f => [tx(f, 'Ocio', 100), tx(f, 'Comida', 200)])
  it('detecta ≥1,5× la media con 3 meses de historial', () => {
    const prep = prepOf([...hist, tx('2026-10-05', 'Ocio', 180), tx('2026-10-06', 'Comida', 220)])
    const r = categoriesAboveUsual(prep, 2026, 9, 28)
    expect(r.enoughHistory).toBe(true)
    expect(r.items.map(i => i.name)).toEqual(['Ocio'])
    expect(r.items[0]).toMatchObject({ val: 180, avg: 100, ratio: 1.8 })
  })
  it('no avisa con menos de 3 meses de historial', () => {
    const prep = prepOf([tx('2026-09-05', 'Ocio', 10), tx('2026-10-05', 'Ocio', 500)])
    expect(categoriesAboveUsual(prep, 2026, 9, 28)).toEqual({ enoughHistory: false, items: [] })
  })
  it('ignora excesos pequeños en euros', () => {
    const h = ['2026-07-05', '2026-08-05', '2026-09-05'].map(f => tx(f, 'Café', 4))
    const prep = prepOf([...h, tx('2026-10-05', 'Café', 9)])
    expect(categoriesAboveUsual(prep, 2026, 9, 28).items).toEqual([])
  })
})

describe('fijos, variables y ahorro', () => {
  it('reparte sobre los ingresos y suma 100', () => {
    const prep = prepOf([tx('2026-10-01', 'Nómina', 1000, 'income'), tx('2026-10-02', 'Piso', 400, 'fixedExpenses'), tx('2026-10-03', 'Comida', 300)])
    const s = fixedVariableSaving(prep, 2026, 9, 28)
    expect(s).toMatchObject({ fixed: 400, variable: 300, saving: 300, deficit: 0, base: 1000 })
    expect(s.pct).toEqual({ fixed: 40, variable: 30, saving: 30 })
  })
  it('con déficit el ahorro es 0 y la base son los gastos', () => {
    const prep = prepOf([tx('2026-10-01', 'Nómina', 100, 'income'), tx('2026-10-02', 'Piso', 300, 'fixedExpenses')])
    const s = fixedVariableSaving(prep, 2026, 9, 28)
    expect(s).toMatchObject({ saving: 0, deficit: 200, base: 300 })
  })
  it('percentSplit suma siempre 100', () => {
    expect(percentSplit([1, 1, 1]).reduce((a, b) => a + b)).toBe(100)
    expect(percentSplit([0, 0, 0])).toEqual([0, 0, 0])
  })
  it('mes sin movimientos', () => {
    expect(fixedVariableSaving(prepOf([]), 2026, 9, 28).empty).toBe(true)
  })
})

describe('recentMonths', () => {
  it('recorta los meses vacíos del principio y marca el mes en curso', () => {
    const prep = prepOf([tx('2026-08-03', 'A', 10), tx('2026-09-03', 'A', 20), tx('2026-10-03', 'A', 5), tx('2026-10-04', 'N', 100, 'income')])
    const r = recentMonths(prep, 2026, 9, 6, NOW)
    expect(r.map(x => x.month)).toEqual([7, 8, 9])
    expect(r.map(x => x.inProgress)).toEqual([false, false, true])
    expect(r[2]).toMatchObject({ income: 100, expenses: 5, balance: 95, savingsRate: 95 })
    expect(r[0].savingsRate).toBeNull()
  })
  it('un solo mes con datos y ninguno', () => {
    expect(recentMonths(prepOf([tx('2026-10-03', 'A', 10)]), 2026, 9, 6, NOW)).toHaveLength(1)
    expect(recentMonths(prepOf([]), 2026, 9, 6, NOW)).toEqual([])
  })
  it('cruza el cambio de año', () => {
    const prep = prepOf([tx('2025-12-03', 'A', 10), tx('2026-01-03', 'A', 10)])
    const r = recentMonths(prep, 2026, 1, 6, new Date(2026, 1, 10))
    expect(r.map(x => `${x.year}-${x.month}`)).toEqual(['2025-11', '2026-0', '2026-1'])
  })
})

describe('niceTicks', () => {
  it('marcas redondas y fijas que incluyen el 0', () => {
    expect(niceTicks(0, 2300)).toEqual([0, 1000, 2000, 3000])
    const t = niceTicks(-150, 900)
    expect(t).toContain(0)
    expect(t[0]).toBeLessThanOrEqual(-150)
    expect(t.at(-1)).toBeGreaterThanOrEqual(900)
    expect(niceTicks(0, 0)).toEqual([0, 1])
  })
})

describe('día de la semana y movimiento más grande', () => {
  // 3 de octubre de 2026 es sábado
  const prep = prepOf([
    tx('2026-10-03', 'Cena', 90), tx('2026-10-10', 'Cena', 60), tx('2026-10-14', 'Café', 6),
    tx('2026-10-01', 'Piso', 800, 'fixedExpenses'), tx('2026-10-02', 'Nómina', 2000, 'income'),
  ])
  it('el sábado es el día más caro y el fijo no cuenta', () => {
    const w = weekdayAverages(prep, 2026, 9, 28)
    expect(w.items).toHaveLength(7)
    expect(w.items[w.maxIndex].name).toBe('sábado')
    expect(w.items[3].avg).toBe(0) // jueves
    // sábados de octubre hasta el 28: 3, 10, 17, 24 -> 150 / 4
    expect(w.items[5].avg).toBe(150 / 4)
  })
  it('movimiento más grande = gasto, no ingreso', () => {
    expect(biggestExpense(prep, 2026, 9, 28)).toMatchObject({ fecha: '2026-10-01', name: 'Piso', importe: 800 })
    expect(biggestExpense(prep, 2026, 9, 0)).toBeNull()
  })
  it('sin datos', () => {
    expect(weekdayAverages(prepOf([]), 2026, 9, 28)).toEqual({ items: [], maxIndex: -1 })
  })
})

describe('recurrentes', () => {
  const rec = (concepto, importe, frecuencia, ultima) => ({ concepto, importe, frecuencia, ultima, proxima: ultima })
  const prep = prepOf([tx('2026-10-01', 'Nómina', 2000, 'income'), tx('2026-10-01', 'Netflix', 12), tx('2026-10-02', 'Piso', 600, 'fixedExpenses')])
  it('quita ingresos, duplicados (queda el último cargo) y caducados', () => {
    const out = cleanRecurring([
      rec('Nómina', 2000, 'mensual', '2026-10-01'),
      rec('Netflix', 11, 'mensual', '2026-08-01'),
      rec('Netflix', 12, 'mensual', '2026-10-01'),
      rec('Piso', 600, 'mensual', '2026-10-02'),
      rec('Gimnasio', 30, 'mensual', '2026-06-01'),       // último cargo hace >2 periodos
      rec('Seguro', 100, 'anual', '2026-01-10'),           // anual vigente
      rec('Roto', 0, 'mensual', '2026-10-01'),
    ], prep.bucketOf, NOW)
    expect(out.map(o => o.concepto).sort()).toEqual(['Netflix', 'Piso', 'Seguro'])
    expect(out.find(o => o.concepto === 'Netflix').importe).toBe(12)
  })
  it('sin información de tipo, descarta nombres de ingreso', () => {
    const out = cleanRecurring([rec('Sueldo extra', 100, 'mensual', '2026-10-01')], new Map(), NOW)
    expect(out).toEqual([])
  })
  it('una fecha ya pasada se corrige: hasta 5 días tarde = hoy; si no, el siguiente periodo', () => {
    const [a] = cleanRecurring([rec('A', 5, 'mensual', '2026-09-24')], new Map(), NOW) // próxima 24 oct (4 días tarde)
    expect(a.next).toEqual(new Date(2026, 9, 28))
    const [b] = cleanRecurring([rec('B', 5, 'mensual', '2026-09-10')], new Map(), NOW) // próxima 10 oct (18 tarde)
    expect(b.next > NOW).toBe(true)
  })
  it('próximos cargos a 30 días con anuales, sin duplicar nombre', () => {
    const r = upcomingCharges({
      recurring: [rec('Netflix', 12, 'mensual', '2026-10-15'), rec('Seguro coche', 300, 'mensual', '2026-10-20'), rec('Lejano', 9, 'anual', '2026-03-01')],
      annual: [{ nombre: 'Seguro coche', importe: 400, mes: 11, dia: 5 }, { nombre: 'IBI', importe: 250, mes: 3, dia: 1 }],
      bucketOf: new Map(), now: NOW,
    })
    expect(r.items.map(i => [i.name, i.fecha])).toEqual([['Seguro coche', '2026-11-05'], ['Netflix', '2026-11-15']])
    expect(r.total).toBe(412)
  })
  it('estado vacío y datos no válidos', () => {
    expect(upcomingCharges({ recurring: null, annual: undefined, bucketOf: new Map(), now: NOW })).toEqual({ items: [], total: 0 })
  })
  it('nextAnnualDate ajusta días inexistentes y pasa al año siguiente', () => {
    expect(nextAnnualDate(2, 30, new Date(2027, 0, 5))).toEqual(new Date(2027, 1, 28))
    expect(nextAnnualDate(3, 1, new Date(2026, 9, 28))).toEqual(new Date(2027, 2, 1))
  })
})

describe('monthEndForecast', () => {
  const base = [
    ...['2026-07-01', '2026-08-01', '2026-09-01'].flatMap(f => [tx(f, 'Nómina', 2000, 'income'), tx(f, 'Piso', 600, 'fixedExpenses'), tx(f, 'Luz', 50, 'fixedExpenses')]),
    tx('2026-10-01', 'Nómina', 2000, 'income'), tx('2026-10-01', 'Piso', 600, 'fixedExpenses'),
    tx('2026-10-10', 'Comida', 280),
  ]
  it('suma gastado + fijos pendientes + variables al ritmo actual', () => {
    const prep = prepOf(base)
    const f = monthEndForecast({ prep, y: 2026, m: 9, now: NOW, recurring: [], annual: [{ nombre: 'IBI', importe: 90, mes: 10, dia: 30 }] })
    expect(f.expectedIncome).toBe(2000)
    expect(f.spent).toBe(880)
    expect(f.pendingFixed).toBe(90 + 50)          // IBI anual + Luz habitual sin cargar
    expect(f.variableRest).toBeCloseTo((280 / 28) * 3)
    expect(f.projectedExpenses).toBeCloseTo(880 + 140 + 30)
    expect(f.result).toBeCloseTo(2000 - 1050)
    expect(f.balanceNow).toBe(1120)
  })
  it('no hay previsión en otros meses ni el día 1; con un solo mes de datos no inventa fijos', () => {
    const prep = prepOf(base)
    expect(monthEndForecast({ prep, y: 2026, m: 8, now: NOW })).toBeNull()
    expect(monthEndForecast({ prep, y: 2026, m: 9, now: new Date(2026, 9, 1) })).toBeNull()
    const solo = monthEndForecast({ prep: prepOf([tx('2026-10-01', 'Piso', 600, 'fixedExpenses')]), y: 2026, m: 9, now: NOW })
    expect(solo.pendingFixed).toBe(0)
    expect(solo.expectedIncome).toBe(0)
  })
})

describe('budgetUsage', () => {
  it('compara el límite con lo gastado y calcula el margen diario', () => {
    const prep = prepOf([tx('2026-10-05', 'Comida', 120), tx('2026-10-06', 'Ocio', 30)])
    const cmp = compareSamePeriod(prep, 2026, 9, NOW)
    const b = budgetUsage([{ name: 'comida', limit: 200 }, { name: 'Ropa', limit: 100 }], cmp.byCat, 4)
    expect(b).toMatchObject({ limit: 300, spent: 120, remaining: 180, over: false, pct: 40, dailyMargin: 45 })
    expect(budgetUsage([{ name: 'Comida', limit: 100 }], cmp.byCat, 4)).toMatchObject({ over: true, dailyMargin: null })
    expect(budgetUsage([], cmp.byCat)).toBeNull()
  })
})

describe('rendimiento', () => {
  it('30.000 movimientos se indexan y calculan en poco tiempo', () => {
    const txs = []
    for (let i = 0; i < 30000; i++) txs.push(tx(`${2022 + (i % 5)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, `Cat${i % 40}`, (i % 90) + 1))
    const t0 = performance.now()
    const prep = prepareTransactions(txs)
    categoryBreakdown(prep, 2026, 9, 28); categoriesAboveUsual(prep, 2026, 9, 28); recentMonths(prep, 2026, 9); weekdayAverages(prep, 2026, 9, 28)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})

describe('recurrentes por mes natural', () => {
  const rec = (ultima, frecuencia = 'mensual') => [{ concepto: 'X', importe: 10, frecuencia, ultima, proxima: ultima }]
  const next = (ultima, now, f) => {
    const [r] = cleanRecurring(rec(ultima, f), new Map(), now)
    const d = r.next
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  it('recibo del día 1: pagado el 1 de octubre, el siguiente es el 1 de noviembre (no el 31)', () => {
    expect(next('2026-10-01', NOW)).toBe('2026-11-01')
  })
  it('días 15, 29, 30 y 31 en meses de 28, 30 y 31 días', () => {
    expect(next('2026-10-15', NOW)).toBe('2026-11-15')
    expect(next('2027-01-29', new Date(2027, 0, 30))).toBe('2027-02-28')
    expect(next('2027-01-30', new Date(2027, 0, 31))).toBe('2027-02-28')
    expect(next('2027-01-31', new Date(2027, 1, 1))).toBe('2027-02-28')
    expect(next('2026-10-31', NOW)).toBe('2026-11-30')
    expect(next('2026-08-31', new Date(2026, 8, 5))).toBe('2026-09-30')
  })
  it('año bisiesto y vuelta al día original', () => {
    expect(next('2028-01-31', new Date(2028, 1, 1))).toBe('2028-02-29')
    expect(next('2028-01-30', new Date(2028, 1, 1))).toBe('2028-02-29')
    // el 28 de febrero ya pasó (1 día tarde): se muestra hoy; luego el ancla (31) se recupera en marzo
    const [r] = cleanRecurring(rec('2027-01-31'), new Map(), new Date(2027, 2, 1))
    expect(r.next).toEqual(new Date(2027, 2, 1))
    expect(next('2027-02-28', new Date(2027, 2, 20))).toBe('2027-03-28')
  })
  it('trimestral, anual y semanal', () => {
    expect(next('2026-08-31', NOW, 'trimestral')).toBe('2026-11-30')
    expect(next('2026-02-28', NOW, 'anual')).toBe('2027-02-28')
    expect(next('2026-10-26', NOW, 'semanal')).toBe('2026-11-02')
  })
  it('el cierre no cuenta dos veces el recibo del día 1', () => {
    const prep = prepOf([
      ...['2026-08-01', '2026-09-01', '2026-10-01'].map(f => tx(f, 'Piso', 800, 'fixedExpenses')),
      tx('2026-10-01', 'Nómina', 2000, 'income'), tx('2026-10-10', 'Comida', 100),
    ])
    const f = monthEndForecast({ prep, y: 2026, m: 9, now: NOW, recurring: rec('2026-10-01').map(r => ({ ...r, concepto: 'Piso', importe: 800 })), annual: [] })
    expect(f.pendingFixed).toBe(0)
    const up = upcomingCharges({ recurring: rec('2026-10-01').map(r => ({ ...r, concepto: 'Piso' })), annual: [], bucketOf: prep.bucketOf, now: NOW })
    expect(up.items[0].fecha).toBe('2026-11-01')
  })
})

describe('casos borde del cierre y tonos', () => {
  it('mes sin movimientos: sin previsión', () => {
    const prep = prepOf([tx('2026-07-01', 'Nómina', 3200, 'income')])
    expect(monthEndForecast({ prep, y: 2026, m: 9, now: NOW })).toBeNull()
  })
  it('último día del mes: no suma ingresos previstos', () => {
    const prep = prepOf([tx('2026-09-01', 'Nómina', 2000, 'income'), tx('2026-10-05', 'Comida', 100)])
    const f = monthEndForecast({ prep, y: 2026, m: 9, now: new Date(2026, 9, 31) })
    expect(f.expectedIncome).toBe(0)
    const g = monthEndForecast({ prep, y: 2026, m: 9, now: NOW })
    expect(g.expectedIncome).toBe(2000)
  })
  it('compareSamePeriod expone el gasto variable (para ocultar la media el día 1)', () => {
    const prep = prepOf([tx('2026-10-01', 'Piso', 800, 'fixedExpenses')])
    const c = compareSamePeriod(prep, 2026, 9, new Date(2026, 9, 1))
    expect(c.cutoff).toBe(1)
    expect(c.variable).toBe(0)
  })
  it('rojo solo por encima del umbral habitual', () => {
    expect(toneOf(60, 50)).toBe('alert')
    expect(toneOf(30, 50)).toBe('neutral')
    expect(toneOf(80, 4)).toBe('neutral')   // exceso pequeño
    expect(toneOf(-25, -20)).toBe('good')
    expect(toneOf(-5, -2)).toBe('neutral')
    expect(toneOf(null)).toBe('neutral')
  })
})
