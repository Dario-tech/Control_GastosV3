// Reparto de un tipo de gasto (fijo o variable) por concepto en un mes:
// los `top` mayores y el resto agrupado en «Otros». Función pura.
export function groupConceptsForMonth(items, monthIndex, top = 5) {
  const rows = (items || [])
    .map(i => ({ name: i.concept, emoji: i.emoji, value: Number(i.amounts?.[monthIndex]) || 0 }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)
  if (rows.length <= top) return rows
  const rest = rows.slice(top).reduce((s, r) => s + r.value, 0)
  return [...rows.slice(0, top), { name: 'Otros', value: rest, isOther: true }]
}
