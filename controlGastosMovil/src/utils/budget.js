// Cálculos de presupuesto compartidos por las tarjetas de Planificación.

// Estados visuales: color + icono + texto
export const BUDGET_STATUS = {
  ok:   { icon: '✓', label: 'En orden' },
  warn: { icon: '!', label: 'Cerca del límite' },
  over: { icon: '✕', label: 'Superado' },
}

export function statusOf(spent, limit, threshold) {
  if (limit > 0 && spent > limit) return 'over'
  if (limit > 0 && (spent / limit) * 100 >= threshold) return 'warn'
  return 'ok'
}

// Progreso de un gasto frente a su límite: % real (puede pasar de 100),
// % acotado para la barra, lo que queda y el estado.
export function budgetProgress(spent, limit, threshold) {
  const rawPct    = limit > 0 ? (spent / limit) * 100 : 0
  const remaining = limit - spent
  return {
    rawPct,
    pct:  Math.min(100, rawPct),
    remaining,
    over: remaining < 0,
    st:   statusOf(spent, limit, threshold),
  }
}

// Días que quedan del mes (0 si no es el mes en curso).
export function daysLeftInMonth(monthIndex) {
  const now = new Date()
  if (now.getMonth() !== monthIndex) return 0
  const lastDay = new Date(now.getFullYear(), monthIndex + 1, 0).getDate()
  return lastDay - now.getDate()
}
