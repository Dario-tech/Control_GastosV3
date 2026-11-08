// Calendario de suscripciones: recurrentes detectados por /api/recurring, con su
// equivalente mensual/anual y la próxima renovación (ordenadas por fecha).
import { cleanRecurring } from './stats'
import { normalizeCategoryName } from '../data/categories'

// Veces al mes que equivale un cargo de cada frecuencia.
const PER_MONTH = { semanal: 52 / 12, quincenal: 2, mensual: 1, trimestral: 1 / 3, anual: 1 / 12 }

const r2 = n => Math.round(n * 100) / 100

export function monthlyEquivalent(importe, frecuencia) {
  const f = PER_MONTH[String(frecuencia || '').toLowerCase()]
  return f ? r2(Number(importe) * f) : 0
}

const pad = n => String(n).padStart(2, '0')
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * @returns {{ items: Array<{concepto, importe, frecuencia, mensual, anual, fecha, dias}>, totalMensual, totalAnual }}
 * `items` ordenados por la próxima renovación; `dias` = días que faltan (0 = hoy).
 */
export function buildSubscriptionCalendar({ recurring, bucketOf, now = new Date(), keys = null }) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const only = keys ? new Set(keys) : null
  const items = cleanRecurring(recurring, bucketOf, now).filter(r => !only || only.has(r.key)).map(r => {
    const mensual = monthlyEquivalent(r.importe, r.frecuencia)
    return {
      key: r.key,
      concepto: r.concepto,
      importe: r.importe,
      frecuencia: r.frecuencia,
      mensual,
      anual: r2(mensual * 12),
      fecha: iso(r.next),
      dias: Math.round((r.next - today) / 86400000),
    }
  })
  items.sort((a, b) => a.fecha.localeCompare(b.fecha) || b.importe - a.importe)
  const totalMensual = r2(items.reduce((s, i) => s + i.mensual, 0))
  return { items, totalMensual, totalAnual: r2(totalMensual * 12) }
}

export function renewalText(dias) {
  if (dias <= 0) return 'Hoy'
  if (dias === 1) return 'Mañana'
  return `En ${dias} días`
}

/**
 * Separa los gastos recurrentes detectados en las suscripciones que el usuario ha
 * marcado (`keys`, nombres de categoría normalizados) y las que aún no (sugerencias).
 */
export function splitSubscriptions({ recurring, bucketOf, keys, now = new Date() }) {
  const marked = buildSubscriptionCalendar({ recurring, bucketOf, now, keys: keys || [] })
  const all = buildSubscriptionCalendar({ recurring, bucketOf, now })
  const mk = new Set(keys || [])
  return { marked, suggestions: all.items.filter(i => !mk.has(i.key)) }
}

/**
 * Las categorías marcadas como suscripción pasan a contar como GASTO FIJO y se
 * agrupan en una sola fila «Suscripciones» (suma mes a mes de todas ellas), igual
 * que mergeAnnualSplits mete los repartos anuales en los fijos. Así saldo, donut,
 * año y estadísticas las tratan de forma coherente. Sin marcadas, devuelve `data` tal cual.
 */
export function groupSubscriptionsAsFixed(data, keys) {
  if (!keys?.length || !data) return data
  const set = new Set(keys)
  const isSub = it => set.has(normalizeCategoryName(it.concept))
  const subs = [...(data.fixedExpenses || []), ...(data.variableExpenses || [])].filter(isSub)
  if (!subs.length) return data
  const amounts = Array(12).fill(0)
  subs.forEach(it => it.amounts.forEach((v, i) => { amounts[i] += v }))
  const row = { concept: 'Suscripciones', emoji: '🔁', amounts, isSubscriptions: true }
  return {
    ...data,
    fixedExpenses: [...data.fixedExpenses.filter(it => !isSub(it)), row],
    variableExpenses: data.variableExpenses.filter(it => !isSub(it)),
  }
}
