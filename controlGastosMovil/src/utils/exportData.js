// Exportación de datos del usuario (JSON completo y CSV de movimientos).
// Todo se genera en el móvil con lo que el servidor ya entrega al usuario.
import { fetchFinanceData, fetchFinanceYear, fetchGoals, fetchAnnualExpenses } from '../services/api'

const TIPO_POR_BUCKET = { income: 'Ingreso', fixedExpenses: 'Gasto Fijo', variableExpenses: 'Gasto Variable' }

export const CSV_COLUMNS = ['fecha', 'tipo', 'concepto', 'importe', 'comentario']

/** Texto de celda seguro: evita la inyección de fórmulas (= + - @ al inicio,
    también tabulador/retorno) y escapa comillas, separador y saltos de línea. */
export function csvCell(value) {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/** Importe con coma decimal y sin separador de miles (12.5 -> "12,50"). */
export function csvAmount(n) {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : ''
}

/** Etiqueta de tipo de un movimiento del servidor (bucket) o ya con su nombre. */
export function tipoLabel(t) {
  return TIPO_POR_BUCKET[t.bucket] || t.tipo || ''
}

/** CSV de movimientos: separador ;, BOM UTF-8 (Excel español), saltos CRLF. */
export function buildCsv(transactions) {
  const rows = [...(transactions || [])].sort((a, b) =>
    String(a.fecha).localeCompare(String(b.fecha)) || (Number(a.rowIndex) || 0) - (Number(b.rowIndex) || 0))
  const lines = [CSV_COLUMNS.join(';')]
  for (const t of rows) {
    lines.push([
      csvCell(t.fecha),
      csvCell(tipoLabel(t)),
      csvCell(t.concepto),
      csvAmount(t.importe),
      csvCell(t.comentario),
    ].join(';'))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** Mensaje claro para un fallo al preparar la exportación. */
export function exportErrorMessage(e) {
  if (e?.status === 401) return e.message
  if (!e?.status || e.status >= 500) {
    return 'No se pudo contactar con el servidor (puede estar despertando). Espera unos segundos y vuelve a intentarlo.'
  }
  return `No se pudo preparar la exportación (${e.message}).`
}

/** Pide los movimientos de TODOS los años (año a año) y los junta sin duplicados.
    `years` = años conocidos (availableYears); si falta, se consulta al servidor.
    Devuelve { transactions, years, unreadable }. Lanza si falla algún año. */
export async function fetchAllTransactions(years) {
  let list = Array.isArray(years) ? years.filter(Number.isFinite) : []
  if (list.length === 0) {
    const first = await fetchFinanceData()
    list = Array.isArray(first?.availableYears) ? first.availableYears : []
    if (list.length === 0) {
      return { transactions: first?.transactions ?? [], years: [], unreadable: Number(first?.unreadable) || 0 }
    }
  }
  const seen = new Set()
  const transactions = []
  let unreadable = 0
  for (const y of [...list].sort((a, b) => a - b)) {
    const res = await fetchFinanceYear(y)
    unreadable += Number(res?.unreadable) || 0
    for (const t of res?.transactions ?? []) {
      const key = t.rowIndex ?? `${t.fecha}|${t.concepto}|${t.importe}|${t.comentario}`
      if (seen.has(key)) continue
      seen.add(key)
      transactions.push(t)
    }
  }
  return { transactions, years: list, unreadable }
}

/** Metas y gastos anuales (best effort: si uno falla se anota y se sigue). */
export async function fetchExtras() {
  const [g, a] = await Promise.allSettled([fetchGoals(), fetchAnnualExpenses()])
  return {
    goals:          g.status === 'fulfilled' && Array.isArray(g.value) ? g.value : null,
    annualExpenses: a.status === 'fulfilled' && Array.isArray(a.value) ? a.value : null,
  }
}

/** Objeto del JSON de exportación completo. */
export function buildExportPayload({ budget, settings, hiddenCategories, transactions, years, unreadable, goals, annualExpenses, now = new Date() }) {
  const out = {
    exportedAt: now.toISOString(),
    budget,
    settings,
    hiddenCategories: hiddenCategories ?? [],
    years: years ?? [],
    transactions: (transactions || []).map(t => ({
      fecha: t.fecha, tipo: tipoLabel(t), concepto: t.concepto, importe: t.importe, comentario: t.comentario || '',
    })),
    goals:          goals ?? [],
    annualExpenses: annualExpenses ?? [],
  }
  const missing = []
  if (goals == null) missing.push('goals')
  if (annualExpenses == null) missing.push('annualExpenses')
  if (missing.length) out.notExported = missing
  if (unreadable) out.unreadableTransactions = unreadable
  return out
}

/** Descarga un texto como fichero (en el navegador). */
export function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
