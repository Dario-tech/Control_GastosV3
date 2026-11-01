import { sumConceptAll } from './index'
import { normalizeCategoryName } from '../data/categories'

// Paleta para el reparto de gastos; el color de cada categoría sale de un hash
// de su nombre normalizado, así no cambia al reordenarse ni entre sesiones.
export const BREAKDOWN_PALETTE = [
  '#5b7cff', '#2dd4a0', '#ff9f43', '#ff5f7e', '#ffd93d', '#6bcfff',
  '#a78bff', '#f472b6', '#34d399', '#fb923c',
]
export const OTHERS_COLOR = '#8b93a7'

export function categoryColor(name) {
  const key = normalizeCategoryName(name)
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return BREAKDOWN_PALETTE[h % BREAKDOWN_PALETTE.length]
}

/**
 * «¿En qué va el dinero?»: gastos (fijos + variables) del año agrupados por su
 * categoría real —por defecto o propia—, de mayor a menor. Se muestran las
 * `limit` principales y el resto se suma en «Otras», de modo que la suma de
 * los importes coincide siempre con `total`.
 * Devuelve { items: [{ key, name, emoji, val, pct, color, isOther }], total }.
 */
export function getExpenseBreakdown(data, limit = 6) {
  const map = new Map()
  for (const it of [...(data?.fixedExpenses || []), ...(data?.variableExpenses || [])]) {
    const val = sumConceptAll(it)
    if (!(val > 0)) continue
    const key = normalizeCategoryName(it.concept) || it.concept
    const prev = map.get(key)
    if (prev) prev.val += val
    else map.set(key, { key, name: it.concept, emoji: it.emoji || '💶', val })
  }
  const all = [...map.values()].sort((a, b) => b.val - a.val)
  const total = all.reduce((s, c) => s + c.val, 0)
  const head = all.slice(0, limit)
  const rest = all.slice(limit)
  const items = head.map(c => ({ ...c, color: categoryColor(c.name), isOther: false }))
  if (rest.length) {
    items.push({
      key: '__otras__', name: 'Otras', emoji: '📦',
      val: rest.reduce((s, c) => s + c.val, 0), color: OTHERS_COLOR, isOther: true,
    })
  }
  items.forEach(c => { c.pct = total > 0 ? Math.round((c.val / total) * 100) : 0 })
  return { items, total }
}
