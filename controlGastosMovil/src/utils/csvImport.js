// Importación de extractos del banco en CSV: lectura y mapeo en el móvil.
// El servidor vuelve a validar todo (mismo parser de importes que /api/pending).

export const MAX_FILE_BYTES = 1_000_000
export const MAX_ROWS = 5000
export const CHUNK = 400            // filas por petición (el servidor admite 500)
export const DELIMITERS = [
  { value: ';',  label: 'Punto y coma' },
  { value: ',',  label: 'Coma' },
  { value: '\t', label: 'Tabulador' },
  { value: '|',  label: 'Barra |' },
]
export const DATE_FORMATS = [
  { value: 'dmy', label: 'DD/MM/AAAA' },
  { value: 'ymd', label: 'AAAA-MM-DD' },
  { value: 'mdy', label: 'MM/DD/AAAA' },
]

/** Separador más probable: el que más veces aparece en la primera línea con datos. */
export function detectDelimiter(text) {
  const first = String(text || '').replace(/^﻿/, '').split(/\r?\n/).find(l => l.trim()) || ''
  let best = ';', max = 0
  for (const { value } of DELIMITERS) {
    const n = first.split(value).length - 1
    if (n > max) { max = n; best = value }
  }
  return best
}

/** CSV -> matriz de celdas. Soporta comillas dobles ("" = comilla) y saltos de línea dentro de comillas. */
export function parseCsv(text, delimiter = ';') {
  const src = String(text || '').replace(/^﻿/, '')
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') {
      quoted = true
    } else if (c === delimiter) {
      row.push(cell); cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(x => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some(x => x.trim() !== '')) rows.push(row)
  return rows
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** Adivina qué columna es fecha / concepto / importe a partir de las cabeceras. */
export function guessColumns(headers) {
  const h = (headers || []).map(norm)
  const find = (...keys) => h.findIndex(x => keys.some(k => x.includes(k)))
  const fecha = find('fecha', 'date', 'f. operacion', 'f.operacion')
  const concepto = find('concepto', 'descripcion', 'comercio', 'detalle', 'movimiento', 'description', 'merchant')
  const importe = find('importe', 'cantidad', 'amount', 'cargo')
  return { fecha, concepto, importe }
}

/** "31/12/2025", "31-12-25", "31.12.2025", "2025-12-31" (+ hora opcional) -> "AAAA-MM-DD" o null. */
export function parseDateCell(raw, format = 'dmy') {
  const s = String(raw || '').trim().split(/[ T]/)[0]
  const m = s.match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/)
  if (!m) return null
  let y, mo, d
  if (format === 'ymd') [y, mo, d] = [m[1], m[2], m[3]]
  else if (format === 'mdy') [mo, d, y] = [m[1], m[2], m[3]]
  else [d, mo, y] = [m[1], m[2], m[3]]
  if (y.length === 2) y = String(2000 + Number(y))
  if (y.length !== 4) return null
  const Y = Number(y), M = Number(mo), D = Number(d)
  const dt = new Date(Date.UTC(Y, M - 1, D))
  if (dt.getUTCFullYear() !== Y || dt.getUTCMonth() !== M - 1 || dt.getUTCDate() !== D) return null
  return `${y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`
}

/** Separa el signo del importe: "-12,30 €", "12,30-", "(12,30)" -> {negativo, texto:"12,30 €"}; vacío -> null. */
export function splitAmountCell(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return null
  let negativo = false
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1).trim() }
  if (/^[-−–]/.test(s)) { negativo = true; s = s.slice(1).trim() }
  else if (/[-−–]$/.test(s)) { negativo = true; s = s.slice(0, -1).trim() }
  if (s.startsWith('+')) s = s.slice(1).trim()
  return s ? { negativo, texto: s } : null
}

/**
 * Convierte la matriz en filas para el servidor.
 * mapping: {fecha, concepto, importe} (índices de columna); hasHeader: la 1ª fila son cabeceras.
 * signMode: 'signo' (negativo = gasto, positivo = ingreso) | 'gastos' (todo es gasto, se ignora el signo).
 * Devuelve { filas: [{linea, fecha, concepto, importe, tipo}], omitidas: [{linea, motivo}] }.
 */
export function buildRows(matrix, { mapping, hasHeader = true, dateFormat = 'dmy', signMode = 'signo' }) {
  const filas = [], omitidas = []
  const start = hasHeader ? 1 : 0
  for (let i = start; i < matrix.length; i++) {
    const r = matrix[i], linea = i + 1
    const fecha = parseDateCell(r[mapping.fecha], dateFormat)
    if (!fecha) { omitidas.push({ linea, motivo: 'Fecha no válida' }); continue }
    const concepto = String(r[mapping.concepto] ?? '').trim()
    if (!concepto) { omitidas.push({ linea, motivo: 'Sin concepto' }); continue }
    const amt = splitAmountCell(r[mapping.importe])
    if (!amt) { omitidas.push({ linea, motivo: 'Sin importe' }); continue }
    const tipo = signMode === 'gastos' || amt.negativo ? 'Gasto Variable' : 'Ingreso'
    filas.push({ linea, fecha, concepto, importe: amt.texto, tipo })
  }
  return { filas, omitidas }
}
