// Cálculos puros de la pantalla Estadísticas. Todo sale de los movimientos que
// ya tiene el cliente (data.transactions, de todos los años), de los
// presupuestos, de los gastos anuales y de los recurrentes detectados; nada se
// inventa. Las funciones reciben `now` para poder probarlas con fechas fijas.
import { normalizeCategoryName } from '../data/categories'
import { categoryColor, OTHERS_COLOR } from './breakdown'

const INCOME = 'income'
const FIXED = 'fixedExpenses'
const VARIABLE = 'variableExpenses'

export const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

// Un cargo recurrente caduca si el último fue hace más de este nº de periodos.
export const RECUR_EXPIRY_PERIODS = 2
// «Por encima de lo habitual»: veces la media y exceso mínimo (en la moneda elegida).
export const UNUSUAL_FACTOR = 1.5
export const UNUSUAL_MIN_EXCESS = 10
export const UNUSUAL_MIN_MONTHS = 3

export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
const ymOf = (y, m) => y * 12 + m
const fromYm = ym => ({ y: Math.floor(ym / 12), m: ym % 12 })
const pad = n => String(n).padStart(2, '0')
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const parseISO = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}
const isoDate = d => isoOf(d.getFullYear(), d.getMonth(), d.getDate())

/** Mes seleccionado ¿es el mes real en curso? */
export function isCurrentMonth(y, m, now = new Date()) {
  return now.getFullYear() === y && now.getMonth() === m
}

/**
 * Indexa los movimientos UNA vez (se memoiza fuera): por mes, con la categoría
 * normalizada ya calculada, y el tipo (ingreso/fijo/variable) y emoji de cada
 * categoría. `emojis` es un mapa concepto -> emoji opcional (de data.*).
 */
export function prepareTransactions(transactions, emojis = {}) {
  const byMonth = new Map()
  const bucketOf = new Map()
  const names = new Map()
  const emojiOf = new Map()
  const catCache = new Map()
  for (const t of transactions || []) {
    const f = String(t?.fecha || '')
    const y = +f.slice(0, 4), m = +f.slice(5, 7) - 1, d = +f.slice(8, 10)
    const importe = Number(t.importe)
    if (!(y > 0) || !(m >= 0 && m <= 11) || !(d >= 1 && d <= 31) || !Number.isFinite(importe)) continue
    let key = catCache.get(t.concepto)
    if (key === undefined) { key = normalizeCategoryName(t.concepto) || String(t.concepto || ''); catCache.set(t.concepto, key) }
    const bucket = t.bucket === INCOME || t.bucket === FIXED ? t.bucket : VARIABLE
    const ym = ymOf(y, m)
    let arr = byMonth.get(ym)
    if (!arr) byMonth.set(ym, (arr = []))
    arr.push({ y, m, d, key, concepto: t.concepto, importe: Math.abs(importe), bucket })
    bucketOf.set(key, bucket)
    if (!names.has(key)) names.set(key, t.concepto)
    if (!emojiOf.has(key) && emojis[t.concepto]) emojiOf.set(key, emojis[t.concepto])
  }
  return { byMonth, bucketOf, names, emojiOf, hasData: byMonth.size > 0 }
}

/** Totales de un mes (hasta el día `cutoff` incluido) y por categoría. */
export function monthTotals(prep, ym, cutoff = 31) {
  const out = { income: 0, fixed: 0, variable: 0, expenses: 0, count: 0, byCat: new Map() }
  for (const t of prep.byMonth.get(ym) || []) {
    if (t.d > cutoff) continue
    out.count++
    if (t.bucket === INCOME) { out.income += t.importe; continue }
    if (t.bucket === FIXED) out.fixed += t.importe
    else out.variable += t.importe
    let c = out.byCat.get(t.key)
    if (!c) out.byCat.set(t.key, (c = { key: t.key, name: t.concepto, val: 0, fixed: 0, variable: 0 }))
    c.val += t.importe
    if (t.bucket === FIXED) c.fixed += t.importe; else c.variable += t.importe
  }
  out.expenses = out.fixed + out.variable
  return out
}

/** Día hasta el que se mira el mes: hoy si es el mes en curso, el último si no. */
export function cutoffDay(y, m, now = new Date()) {
  return isCurrentMonth(y, m, now) ? now.getDate() : daysInMonth(y, m)
}

const pctChange = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null)

/**
 * «Este mes»: gasto del tramo día 1..cutoff frente al MISMO tramo del mes
 * anterior (limitado a los días que tuvo ese mes: 28/29/30/31). Nunca compara un
 * mes a medias con uno completo.
 */
export function compareSamePeriod(prep, y, m, now = new Date()) {
  const current = isCurrentMonth(y, m, now)
  const dim = daysInMonth(y, m)
  const cutoff = cutoffDay(y, m, now)
  const ym = ymOf(y, m)
  const { y: py, m: pm } = fromYm(ym - 1)
  const prevDim = daysInMonth(py, pm)
  const prevCutoff = Math.min(cutoff, prevDim)
  const cur = monthTotals(prep, ym, cutoff)
  const prev = monthTotals(prep, ym - 1, prevCutoff)
  const hasPrev = prev.count > 0
  const delta = cur.expenses - prev.expenses
  return {
    isCurrent: current, daysInMonth: dim, cutoff, daysLeft: current ? dim - cutoff : 0,
    prevMonth: pm, prevYear: py, prevCutoff, hasPrev,
    spent: cur.expenses, prevSpent: prev.expenses,
    delta: hasPrev ? delta : null,
    tone: hasPrev ? toneOf(pctChange(cur.expenses, prev.expenses), delta) : 'neutral',
    pct: hasPrev ? pctChange(cur.expenses, prev.expenses) : null,
    avgDaily: cutoff > 0 ? cur.expenses / cutoff : 0,
    prevAvgDaily: prevCutoff > 0 ? prev.expenses / prevCutoff : 0,
    variable: cur.variable, income: cur.income, byCat: cur.byCat, count: cur.count,
  }
}

/** Presupuesto del mes frente a lo gastado en las categorías presupuestadas. */
export function budgetUsage(items, byCat, daysLeftIncludingToday = 0) {
  const list = (items || []).filter(i => i.limit > 0)
  if (!list.length) return null
  const limit = list.reduce((s, i) => s + i.limit, 0)
  const spent = list.reduce((s, i) => s + (byCat.get(normalizeCategoryName(i.name))?.val || 0), 0)
  const remaining = limit - spent
  return {
    limit, spent, remaining, over: remaining < 0,
    pct: limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0,
    dailyMargin: daysLeftIncludingToday > 0 && remaining > 0 ? remaining / daysLeftIncludingToday : null,
  }
}

/**
 * Media por categoría de los hasta 3 meses anteriores, para el mismo tramo
 * (días 1..cutoff, limitado a la longitud de cada mes). Solo cuentan los meses
 * con algún gasto. Devuelve { months, avg: Map(key -> media) }.
 */
export function baselineByCategory(prep, y, m, cutoff, monthsBack = 3) {
  const ym = ymOf(y, m)
  const sums = new Map()
  let months = 0
  for (let i = 1; i <= monthsBack; i++) {
    const { y: by, m: bm } = fromYm(ym - i)
    const tot = monthTotals(prep, ym - i, Math.min(cutoff, daysInMonth(by, bm)))
    if (tot.expenses <= 0) continue
    months++
    tot.byCat.forEach(c => sums.set(c.key, (sums.get(c.key) || 0) + c.val))
  }
  const avg = new Map()
  // Se divide entre los meses con datos (no entre 3 fijos) para no inventar bajadas.
  if (months) sums.forEach((v, k) => avg.set(k, v / months))
  return { months, avg }
}

/**
 * Tono de una variación de gasto: rojo solo si supera el umbral «habitual»
 * (×1,5 y exceso mínimo), verde si baja de forma apreciable, neutro el resto.
 */
export function toneOf(pct, excess = Infinity) {
  if (pct == null) return 'neutral'
  if (pct >= (UNUSUAL_FACTOR - 1) * 100 && excess >= UNUSUAL_MIN_EXCESS) return 'alert'
  if (pct <= -10) return 'good'
  return 'neutral'
}

function variation(cur, base) {
  if (!(base > 0)) return null
  const pct = Math.round(((cur - base) / base) * 100)
  return { pct, dir: pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat', tone: toneOf(pct, cur - base) }
}

/**
 * «Dónde va el dinero»: top `limit` categorías del mes + «Otras», con % del
 * gasto y variación frente a la media del mismo tramo de los 3 meses anteriores.
 */
export function categoryBreakdown(prep, y, m, cutoff, limit = 6) {
  const cur = monthTotals(prep, ymOf(y, m), cutoff)
  const all = [...cur.byCat.values()].sort((a, b) => b.val - a.val)
  const total = cur.expenses
  const base = baselineByCategory(prep, y, m, cutoff)
  const head = all.slice(0, limit)
  const rest = all.slice(limit)
  const mk = c => ({
    key: c.key, name: prep.names.get(c.key) || c.name, emoji: prep.emojiOf.get(c.key) || '💶', val: c.val,
    pct: total > 0 ? Math.round((c.val / total) * 100) : 0, color: categoryColor(c.name), isOther: false,
    change: base.months ? variation(c.val, base.avg.get(c.key) || 0) : null,
  })
  const items = head.map(mk)
  if (rest.length) {
    const val = rest.reduce((s, c) => s + c.val, 0)
    const baseRest = rest.reduce((s, c) => s + (base.avg.get(c.key) || 0), 0)
    items.push({
      key: '__otras__', name: 'Otras', emoji: '📦', val, pct: total > 0 ? Math.round((val / total) * 100) : 0,
      color: OTHERS_COLOR, isOther: true, change: base.months ? variation(val, baseRest) : null,
    })
  }
  return { items, total, baselineMonths: base.months }
}

/**
 * «Por encima de lo habitual»: categorías cuyo gasto (mismo tramo) supera
 * UNUSUAL_FACTOR × su media, con al menos 3 meses de historial anteriores.
 */
export function categoriesAboveUsual(prep, y, m, cutoff) {
  const base = baselineByCategory(prep, y, m, cutoff)
  if (base.months < UNUSUAL_MIN_MONTHS) return { enoughHistory: false, items: [] }
  const cur = monthTotals(prep, ymOf(y, m), cutoff)
  const items = []
  cur.byCat.forEach(c => {
    const avg = base.avg.get(c.key) || 0
    if (avg > 0 && c.val >= avg * UNUSUAL_FACTOR && c.val - avg >= UNUSUAL_MIN_EXCESS) {
      items.push({
        key: c.key, name: prep.names.get(c.key) || c.name, emoji: prep.emojiOf.get(c.key) || '💶',
        val: c.val, avg, ratio: Math.round((c.val / avg) * 10) / 10,
      })
    }
  })
  items.sort((a, b) => (b.val - b.avg) - (a.val - a.avg))
  return { enoughHistory: true, items }
}

/** Reparto de enteros que suma exactamente 100 (método del mayor resto). */
export function percentSplit(values) {
  const total = values.reduce((s, v) => s + v, 0)
  if (!(total > 0)) return values.map(() => 0)
  const raw = values.map(v => (v / total) * 100)
  const out = raw.map(Math.floor)
  let left = 100 - out.reduce((s, v) => s + v, 0)
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0 && values[i] > 0) { out[i]++; left-- } })
  return out
}

/** «Fijos · variables · ahorro» del mes: base = el mayor entre ingresos y gastos. */
export function fixedVariableSaving(prep, y, m, cutoff) {
  const t = monthTotals(prep, ymOf(y, m), cutoff)
  const saving = Math.max(0, t.income - t.expenses)
  const deficit = Math.max(0, t.expenses - t.income)
  const base = Math.max(t.income, t.expenses)
  const [pf, pv, ps] = percentSplit([t.fixed, t.variable, saving])
  return { fixed: t.fixed, variable: t.variable, saving, deficit, income: t.income, base, pct: { fixed: pf, variable: pv, saving: ps }, empty: t.fixed + t.variable + t.income <= 0 }
}

/**
 * «Últimos 6 meses»: ingresos, gastos y balance por mes natural, terminando en
 * el mes mirado. Se recortan los meses vacíos del principio (no se inventan
 * tendencias); el mes real en curso va marcado `inProgress`.
 */
export function recentMonths(prep, y, m, count = 6, now = new Date()) {
  const end = ymOf(y, m)
  const rows = []
  for (let ym = end - count + 1; ym <= end; ym++) {
    const { y: ry, m: rm } = fromYm(ym)
    const t = monthTotals(prep, ym)
    rows.push({
      ym, year: ry, month: rm, income: t.income, expenses: t.expenses, balance: t.income - t.expenses,
      savingsRate: t.income > 0 ? Math.round(((t.income - t.expenses) / t.income) * 100) : null,
      hasData: t.count > 0, inProgress: isCurrentMonth(ry, rm, now),
    })
  }
  while (rows.length && !rows[0].hasData) rows.shift()
  return rows
}

/** Marcas «redondas» para un eje Y fijo (incluye siempre el 0). */
export function niceTicks(minVal, maxVal, target = 4) {
  const lo0 = Math.min(0, minVal), hi0 = Math.max(0, maxVal)
  if (hi0 === lo0) return [0, 1]
  const raw = (hi0 - lo0) / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) || 10 * mag
  const ticks = []
  const end = Math.ceil(hi0 / step) * step
  for (let v = Math.floor(lo0 / step) * step; v <= end + step / 1e6; v += step) ticks.push(Math.round(v * 100) / 100)
  return ticks
}

/** Movimiento de gasto más grande del mes (hasta `cutoff`). */
export function biggestExpense(prep, y, m, cutoff) {
  let best = null
  for (const t of prep.byMonth.get(ymOf(y, m)) || []) {
    if (t.bucket === INCOME || t.d > cutoff) continue
    if (!best || t.importe > best.importe) best = t
  }
  if (!best) return null
  return { fecha: isoOf(best.y, best.m, best.d), key: best.key, name: prep.names.get(best.key) || best.concepto, emoji: prep.emojiOf.get(best.key) || '💶', importe: best.importe }
}

/**
 * Gasto variable medio por día de la semana (lunes=0), en los 3 últimos meses
 * hasta el mes mirado (el en curso, solo hasta hoy). Se divide entre cuántos
 * días de ese tipo hubo en el periodo, incluidos los de gasto cero. Los fijos se
 * dejan fuera: caen en fechas fijas y falsean el día.
 */
export function weekdayAverages(prep, y, m, cutoff, months = 3) {
  const end = ymOf(y, m)
  const sums = Array(7).fill(0)
  const days = Array(7).fill(0)
  let anyData = false
  for (let ym = end - months + 1; ym <= end; ym++) {
    const { y: ry, m: rm } = fromYm(ym)
    const last = ym === end ? cutoff : daysInMonth(ry, rm)
    const txs = prep.byMonth.get(ym)
    if (!txs) continue
    anyData = true
    for (let d = 1; d <= last; d++) days[(new Date(ry, rm, d).getDay() + 6) % 7]++
    for (const t of txs) {
      if (t.bucket !== VARIABLE || t.d > last) continue
      sums[(new Date(t.y, t.m, t.d).getDay() + 6) % 7] += t.importe
    }
  }
  if (!anyData) return { items: [], maxIndex: -1 }
  const items = sums.map((s, i) => ({ index: i, name: DAY_NAMES[i], avg: days[i] > 0 ? s / days[i] : 0, total: s }))
  const max = Math.max(...items.map(i => i.avg))
  return { items, maxIndex: max > 0 ? items.findIndex(i => i.avg === max) : -1 }
}

// ── Recurrentes y gastos anuales ───────────────────────────────────────────

// Periodo de cada frecuencia: días fijos (semanal, quincenal) o meses naturales.
const PERIODS = {
  semanal: { days: 7 }, quincenal: { days: 15 },
  mensual: { months: 1 }, trimestral: { months: 3 }, anual: { months: 12 },
}

/**
 * Siguiente fecha tras `date` según el periodo. Los periodos en meses avanzan por
 * MES NATURAL conservando el día del cargo (`anchor`), recortado al último día si
 * el mes es más corto: 31 ene -> 28/29 feb -> 31 mar.
 */
export function shiftPeriod(date, period, anchor = date.getDate()) {
  if (period.days) return addDays(date, period.days)
  const first = new Date(date.getFullYear(), date.getMonth() + period.months, 1)
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor, daysInMonth(first.getFullYear(), first.getMonth())))
}
const INCOME_RE = /n[oó]mina|salario|sueldo|ingreso|bonus|reembolso/i

/**
 * Solo GASTOS recurrentes, sin duplicados (un concepto con varios importes se
 * queda con el último cargo) y sin caducados. Una próxima fecha ya pasada se
 * corrige: hasta 5 días tarde se muestra «hoy»; si no, se avanza por periodos.
 */
export function cleanRecurring(items, bucketOf, now = new Date()) {
  const today = startOfDay(now)
  const byKey = new Map()
  for (const r of Array.isArray(items) ? items : []) {
    const key = normalizeCategoryName(r?.concepto)
    const period = PERIODS[String(r?.frecuencia || '').toLowerCase()]
    const last = parseISO(r?.ultima)
    const importe = Number(r?.importe)
    if (!key || !period || !last || !(importe > 0)) continue
    const bucket = bucketOf?.get(key)
    if (bucket === INCOME || (!bucket && INCOME_RE.test(r.concepto))) continue
    const prev = byKey.get(key)
    if (prev && prev.last >= last) continue
    byKey.set(key, { concepto: r.concepto, key, importe, frecuencia: r.frecuencia, period, last })
  }
  const out = []
  for (const r of byKey.values()) {
    const anchor = r.last.getDate()
    // Caduca si han pasado más de 2 periodos desde el último cargo.
    if (today > shiftPeriod(shiftPeriod(r.last, r.period, anchor), r.period, anchor)) continue
    let next = shiftPeriod(r.last, r.period, anchor)
    if (next < today) {
      const late = Math.round((today - next) / 86400000)
      if (late <= 5) next = today
      else while (next < today) next = shiftPeriod(next, r.period, anchor)
    }
    out.push({ concepto: r.concepto, key: r.key, importe: r.importe, frecuencia: r.frecuencia, period: r.period, anchor, ultima: isoDate(r.last), next })
  }
  return out.sort((a, b) => a.next - b.next || b.importe - a.importe)
}

/** Próximo vencimiento (Date) de un gasto anual con mes 1-12 y día. */
export function nextAnnualDate(mes, dia, now = new Date()) {
  const today = startOfDay(now)
  const at = yr => new Date(yr, mes - 1, Math.min(dia || 1, daysInMonth(yr, mes - 1)))
  const d = at(today.getFullYear())
  return d >= today ? d : at(today.getFullYear() + 1)
}

/**
 * «Próximos cargos»: recurrentes (limpios) y gastos anuales en los próximos
 * `days` días. Si un anual y un recurrente coinciden por nombre, manda el anual.
 */
export function upcomingCharges({ recurring, annual, bucketOf, now = new Date(), days = 30 }) {
  const today = startOfDay(now)
  const limit = addDays(today, days)
  const out = []
  const annualKeys = new Set()
  for (const a of Array.isArray(annual) ? annual : []) {
    const importe = Number(a?.importe)
    if (!a?.nombre || !(importe > 0) || !a.mes) continue
    const key = normalizeCategoryName(a.nombre)
    annualKeys.add(key)
    const date = nextAnnualDate(a.mes, a.dia, now)
    if (date <= limit) out.push({ key, name: a.nombre, importe, date, kind: 'anual' })
  }
  for (const r of cleanRecurring(recurring, bucketOf, now)) {
    if (annualKeys.has(r.key)) continue
    if (r.next <= limit) out.push({ key: r.key, name: r.concepto, importe: r.importe, date: r.next, kind: r.frecuencia })
  }
  out.sort((a, b) => a.date - b.date || b.importe - a.importe)
  return { items: out.map(o => ({ ...o, fecha: isoDate(o.date) })), total: out.reduce((s, o) => s + o.importe, 0) }
}

/**
 * «Cierre previsto» (solo mes en curso, desde el día 2):
 * ingresos previstos − (gastado hasta hoy + fijos pendientes + variables al ritmo actual).
 * - Ingresos: lo cobrado o, si es menos, la media de los meses anteriores con ingresos.
 * - Fijos pendientes: recurrentes y gastos anuales que vencen lo que queda de mes,
 *   y fijos habituales (presentes en los meses anteriores) aún sin cargar.
 * - Variables: gasto variable medio diario hasta hoy × días que quedan (sin contar
 *   lo que ya se trata como recurrente).
 */
export function monthEndForecast({ prep, y, m, now = new Date(), recurring, annual }) {
  if (!isCurrentMonth(y, m, now)) return null
  const day = now.getDate()
  if (day < 2) return null
  const dim = daysInMonth(y, m)
  const left = dim - day
  const ym = ymOf(y, m)
  const cur = monthTotals(prep, ym, day)
  if (cur.count === 0) return null  // sin movimientos no hay base para prever
  const today = startOfDay(now)
  const endOfMonth = new Date(y, m, dim)

  const prior = []
  for (let i = 1; i <= 3; i++) { const t = monthTotals(prep, ym - i); if (t.count > 0) prior.push(t) }
  const incomes = prior.map(p => p.income).filter(v => v > 0)
  const avgIncome = incomes.length ? incomes.reduce((s, v) => s + v, 0) / incomes.length : 0
  // El último día ya no queda tiempo para cobrar: no se suman ingresos previstos.
  const expectedIncome = left === 0 ? cur.income : Math.max(cur.income, avgIncome)

  const pendingItems = []
  const recKeys = new Set()
  const annualKeys = new Set()
  for (const a of Array.isArray(annual) ? annual : []) {
    const importe = Number(a?.importe)
    if (!a?.nombre || !(importe > 0) || !a.mes) continue
    const key = normalizeCategoryName(a.nombre)
    annualKeys.add(key)
    const date = nextAnnualDate(a.mes, a.dia, now)
    if (date >= today && date <= endOfMonth && !cur.byCat.has(key)) pendingItems.push({ key, name: a.nombre, importe })
  }
  for (const r of cleanRecurring(recurring, prep.bucketOf, now)) {
    if (annualKeys.has(r.key)) continue
    recKeys.add(r.key)
    for (let d = r.next; d <= endOfMonth; d = shiftPeriod(d, r.period, r.anchor)) pendingItems.push({ key: r.key, name: r.concepto, importe: r.importe })
  }
  if (prior.length >= 2) {
    const used = new Set(pendingItems.map(p => p.key))
    const sums = new Map(), seen = new Map()
    prior.forEach(p => p.byCat.forEach(c => {
      if (prep.bucketOf.get(c.key) !== FIXED) return
      sums.set(c.key, (sums.get(c.key) || 0) + c.val)
      seen.set(c.key, (seen.get(c.key) || 0) + 1)
    }))
    sums.forEach((sum, key) => {
      if (seen.get(key) === prior.length && !cur.byCat.has(key) && !used.has(key) && !recKeys.has(key))
        pendingItems.push({ key, name: prep.names.get(key) || key, importe: sum / prior.length })
    })
  }
  const pendingFixed = pendingItems.reduce((s, p) => s + p.importe, 0)

  let variableSoFar = 0
  cur.byCat.forEach(c => { if (!recKeys.has(c.key) && !annualKeys.has(c.key)) variableSoFar += c.variable })
  const variableRest = (variableSoFar / day) * left

  const spent = cur.expenses
  const projectedExpenses = spent + pendingFixed + variableRest
  return {
    day, daysInMonth: dim, daysLeft: left,
    incomeSoFar: cur.income, expectedIncome, spent, pendingFixed, pendingCount: pendingItems.length, variableRest,
    projectedExpenses, result: expectedIncome - projectedExpenses,
    balanceNow: cur.income - cur.expenses,
    lowConfidence: day < 5,
  }
}
