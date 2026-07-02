// Importa gastos/ingresos desde un Google Sheets publicado como CSV
// (Archivo > Compartir > Publicar en la web > seleccionar hoja > formato CSV)
// El CSV publicado de Google tiene cabeceras CORS abiertas, así que se puede
// hacer fetch directo desde el navegador, sin proxy ni API key.

const ACCENT_MARKS = new RegExp(String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f), 'g')

function stripAccents(s) {
  return s.normalize('NFD').replace(ACCENT_MARKS, '')
}

function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

function parseNumber(raw) {
  let s = String(raw ?? '').trim().replace(/[€\s]/g, '')
  if (!s) return 0
  // formato español "1.234,56" → quitar puntos de miles, coma a punto
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

const TYPE_MAP = {
  ingreso: 'income', ingresos: 'income',
  fijo: 'fixedExpenses', fijos: 'fixedExpenses',
  variable: 'variableExpenses', variables: 'variableExpenses',
}

const MONTH_COLS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export async function fetchSheetData(csvUrl) {
  const res = await fetch(csvUrl, { signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`Sheets ${res.status}`)
  const text = await res.text()
  const rows = parseCSV(text)
  if (rows.length < 2) throw new Error('Sheets: la hoja está vacía')

  const header = rows[0].map(h => stripAccents(h.trim().toLowerCase()))
  const idx = {
    tipo:     header.indexOf('tipo'),
    concepto: header.indexOf('concepto'),
    emoji:    header.indexOf('emoji'),
    months:   MONTH_COLS.map(m => header.indexOf(m)),
  }
  if (idx.tipo === -1 || idx.concepto === -1) {
    throw new Error('Sheets: faltan columnas "tipo" o "concepto"')
  }

  const result = {
    year: new Date().getFullYear(),
    activeMonths: Array(12).fill(false),
    income: [], fixedExpenses: [], variableExpenses: [],
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const bucket = TYPE_MAP[stripAccents((row[idx.tipo] ?? '').trim().toLowerCase())]
    if (!bucket) continue
    const concept = (row[idx.concepto] ?? '').trim()
    if (!concept) continue
    const emoji = idx.emoji !== -1 ? (row[idx.emoji] ?? '').trim() : ''

    const amounts = idx.months.map((colIdx, m) => {
      const v = colIdx !== -1 ? parseNumber(row[colIdx]) : 0
      if (v !== 0) result.activeMonths[m] = true
      return v
    })

    result[bucket].push({ concept, emoji: emoji || '💶', amounts })
  }

  if (!result.income.length && !result.fixedExpenses.length && !result.variableExpenses.length) {
    throw new Error('Sheets: no se encontraron filas válidas')
  }

  return result
}
