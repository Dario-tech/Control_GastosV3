// Gastos fijos que se repiten cada mes hasta una fecha: se proyectan como gasto fijo
// PREVISTO en cada mes del año (sin crear movimientos). Si ese mes el usuario apunta
// el real (misma categoría), el real sustituye al previsto.
import { normalizeCategoryName } from '../data/categories'

const ymNum = ym => { const [y, m] = String(ym).split('-').map(Number); return y * 12 + (m - 1) }

/** ¿La regla está activa en el mes `m` (0-11) del año `year`? */
export function ruleCoversMonth(rule, year, m) {
  const cur = year * 12 + m
  if (cur < ymNum(rule.desde)) return false
  return !rule.hasta || cur <= ymNum(rule.hasta)
}

export function mergeFixedRecurring(data, rules, year) {
  if (!rules?.length || !data) return data
  let fixed = [...data.fixedExpenses]
  const real = (name, m) => [...fixed, ...data.variableExpenses]
    .some(it => normalizeCategoryName(it.concept) === name && it.amounts[m] > 0)
  const activeMonths = [...data.activeMonths]
  let changed = false
  for (const rule of rules) {
    const name = normalizeCategoryName(rule.concepto)
    const months = []
    for (let m = 0; m < 12; m++) if (ruleCoversMonth(rule, year, m) && !real(name, m)) months.push(m)
    if (!months.length) continue
    changed = true
    months.forEach(m => { activeMonths[m] = true })
    const idx = fixed.findIndex(it => normalizeCategoryName(it.concept) === name)
    if (idx >= 0) {
      const amounts = [...fixed[idx].amounts]
      months.forEach(m => { amounts[m] = rule.importe })
      fixed[idx] = { ...fixed[idx], amounts }
    } else {
      const amounts = Array(12).fill(0)
      months.forEach(m => { amounts[m] = rule.importe })
      fixed = [...fixed, { concept: rule.concepto, emoji: '🔁', amounts, isProjected: true }]
    }
  }
  return changed ? { ...data, activeMonths, fixedExpenses: fixed } : data
}

/** 'AAAA-MM' del mes siguiente a una fecha 'AAAA-MM-DD'. */
export function nextMonthOf(isoDate) {
  const [y, m] = isoDate.split('-').map(Number)
  const n = y * 12 + m          // m es 1-12, así que y*12+m = índice del mes siguiente
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
}
