// Calendario de suscripciones: recurrentes detectados por /api/recurring, con su
// equivalente mensual/anual y la próxima renovación (ordenadas por fecha).
import { cleanRecurring } from './stats'

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
export function buildSubscriptionCalendar({ recurring, bucketOf, now = new Date() }) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const items = cleanRecurring(recurring, bucketOf, now).map(r => {
    const mensual = monthlyEquivalent(r.importe, r.frecuencia)
    return {
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
