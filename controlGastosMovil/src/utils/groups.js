// Gastos compartidos: ayudas de formulario (el servidor valida y calcula todo de nuevo).

/** "12,5" / "12.50" / "1.234,56" -> número, o null si no es un importe positivo válido. */
export function parseAmountInput(raw) {
  let s = String(raw ?? '').replace(/[\s€]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}

/** Céntimos de reparto a partes iguales; el resto va a los primeros por email (igual que el servidor). */
export function equalSplit(totalEuros, emails) {
  const orden = [...new Set(emails)].sort()
  if (!orden.length || !(totalEuros > 0)) return {}
  const total = Math.round(totalEuros * 100)
  const base = Math.floor(total / orden.length)
  const resto = total - base * orden.length
  return Object.fromEntries(orden.map((e, i) => [e, (base + (i < resto ? 1 : 0)) / 100]))
}

/** Lo que falta (+) o sobra (−) para que las partes sumen el total, en euros. */
export function splitDifference(totalEuros, parts) {
  const sum = Object.values(parts).reduce((s, v) => s + Math.round((Number(v) || 0) * 100), 0)
  return (Math.round(totalEuros * 100) - sum) / 100
}

/** Frase para una deuda: «Beto debe 30 € a Ana». */
export function debtText(d, nameOf, fmtMoney) {
  return `${nameOf(d.de)} debe ${fmtMoney(d.importe)} a ${nameOf(d.a)}`
}
