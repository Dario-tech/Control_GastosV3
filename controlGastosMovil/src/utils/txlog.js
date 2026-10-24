// Lógica pura de la hoja de detalle de categoría (TransactionLogModal) y de su
// editor de movimientos: filtrado, agrupado por día, resumen del mes y cálculo
// del cuerpo parcial del PATCH. Sin React ni API, para poder testearla aislada.

import { MONTH_NAMES } from '../data/mockData'
import { localISODate } from './index'

const WEEKDAYS       = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

// /api/finance devuelve `bucket` en cada transacción; el formulario y el
// backend hablan en `tipo` (los mismos valores que TYPES en data/categories).
const BUCKET_TO_TIPO = {
  income:           'Ingreso',
  fixedExpenses:    'Gasto Fijo',
  variableExpenses: 'Gasto Variable',
}
const TIPO_TO_BUCKET = Object.fromEntries(Object.entries(BUCKET_TO_TIPO).map(([b, t]) => [t, b]))

export function bucketToTipo(bucket) {
  return BUCKET_TO_TIPO[bucket] || 'Gasto Variable'
}

export function tipoToBucket(tipo) {
  return TIPO_TO_BUCKET[tipo] || 'variableExpenses'
}

export { localISODate }

function parseISO(fecha) {
  const [y, m, d] = String(fecha || '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/** Etiquetas de un día: número, día de la semana corto y texto largo accesible. */
export function dayLabel(fecha, today = localISODate()) {
  const date = parseISO(fecha)
  if (!date) return { day: '', weekday: '', long: String(fecha || '') }
  const yest = parseISO(today)
  yest?.setDate(yest.getDate() - 1)
  const isToday = fecha.slice(0, 10) === today
  const isYesterday = !!yest && localISODate(yest) === fecha.slice(0, 10)
  const wd = date.getDay()
  const long = `${WEEKDAYS[wd]} ${date.getDate()} de ${MONTH_NAMES[date.getMonth()].toLowerCase()}`
  return {
    day:     String(date.getDate()),
    weekday: isToday ? 'hoy' : isYesterday ? 'ayer' : WEEKDAYS_SHORT[wd],
    long:    isToday ? `hoy, ${long}` : isYesterday ? `ayer, ${long}` : long,
  }
}

/** Mes y año anteriores (enero → diciembre del año anterior). */
export function prevMonthOf(monthIndex, year) {
  return monthIndex === 0 ? { month: 11, year: year - 1 } : { month: monthIndex - 1, year }
}

function txYear(t) {
  return parseInt(String(t.fecha).slice(0, 4), 10)
}

/** Movimientos de una categoría en un mes, del más reciente al más antiguo. */
export function filterCategoryMonth(transactions, concept, monthIndex, year) {
  return (transactions || [])
    .filter(t => t.concepto === concept && t.month === monthIndex && (!year || txYear(t) === Number(year)))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || (Number(b.rowIndex) || 0) - (Number(a.rowIndex) || 0))
}

/** Agrupa filas ya ordenadas por día, conservando el orden. */
export function groupByDay(rows) {
  const groups = []
  for (const t of rows) {
    const fecha = String(t.fecha).slice(0, 10)
    const last = groups[groups.length - 1]
    if (last && last.fecha === fecha) {
      last.items.push(t)
      last.total += Math.abs(t.importe)
    } else {
      groups.push({ fecha, items: [t], total: Math.abs(t.importe) })
    }
  }
  return groups
}

/**
 * Resumen del mes: total, nº, media y comparación con el mes anterior.
 * `diff`/`pct` son null si el mes anterior no tiene movimientos.
 */
export function summarize(rows, prevRows = []) {
  const total = rows.reduce((s, t) => s + Math.abs(t.importe), 0)
  const count = rows.length
  const prevTotal = prevRows.reduce((s, t) => s + Math.abs(t.importe), 0)
  const hasPrev = prevRows.length > 0 && prevTotal > 0
  return {
    total,
    count,
    avg:       count ? total / count : 0,
    prevTotal,
    diff:      hasPrev ? total - prevTotal : null,
    pct:       hasPrev ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
  }
}

/** Convierte el texto del input de importe ("12,5") en número; NaN si no vale. */
export function parseAmount(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/** Estado inicial del borrador del editor a partir de una transacción. */
export function draftFromTx(t) {
  const imp = Math.abs(Number(t.importe) || 0)
  return {
    importe:    Number.isInteger(imp) ? String(imp) : imp.toFixed(2).replace('.', ','),
    fecha:      String(t.fecha).slice(0, 10),
    tipo:       t.tipo || bucketToTipo(t.bucket),
    concepto:   t.concepto,
    comentario: t.comentario || '',
  }
}

/** Valida el borrador; devuelve el mensaje de error o '' si es válido. */
export function validateDraft(d) {
  const amt = parseAmount(d.importe)
  if (!(amt > 0)) return 'Escribe un importe mayor que 0'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) return 'Elige una fecha'
  if (!d.tipo) return 'Elige un tipo'
  if (!d.concepto) return 'Elige una categoría'
  return ''
}

/**
 * Cuerpo parcial para PATCH /api/transactions/{id}: solo los campos que
 * cambian respecto a la transacción original. `{}` = no hay cambios.
 */
export function buildTransactionPatch(original, draft) {
  const base = draftFromTx(original)
  const patch = {}
  const amt = parseAmount(draft.importe)
  if (Number.isFinite(amt) && Math.round(amt * 100) !== Math.round(Math.abs(Number(original.importe) || 0) * 100)) {
    patch.importe = Math.round(amt * 100) / 100
  }
  if (draft.fecha !== base.fecha)                     patch.fecha = draft.fecha
  if (draft.tipo !== base.tipo)                       patch.tipo = draft.tipo
  if (draft.concepto !== base.concepto)               patch.concepto = draft.concepto
  const com = (draft.comentario || '').trim()
  if (com !== (base.comentario || '').trim())         patch.comentario = com
  return patch
}

/** Aplica la respuesta del PATCH a la transacción local (mismo formato que /api/finance). */
export function applyUpdate(t, res) {
  const fecha = String(res?.fecha ?? t.fecha).slice(0, 10)
  const tipo  = res?.tipo ?? t.tipo
  return {
    ...t,
    fecha,
    month:      parseInt(fecha.slice(5, 7), 10) - 1,
    concepto:   res?.concepto ?? t.concepto,
    importe:    res?.importe != null ? Math.abs(Number(res.importe)) : t.importe,
    comentario: res?.comentario ?? t.comentario,
    ...(tipo ? { tipo, bucket: tipoToBucket(tipo) } : {}),
  }
}
