import { SHORTCUT_QUEUE_KEY } from './storageKeys'

/* Recepción de pagos de Apple Pay enviados por el Atajo de iOS.

   El Atajo (automatización "Transacción" de Cartera) abre la app con
   `/?atajo=1&importe=<Importe>&comercio=<Comercio>[&fecha=…][&id=…]`.
   Aquí se lee esa URL, se limpia (para que recargar no lo repita) y se guarda
   en una cola en localStorage hasta que se consigue enviar al backend: así no
   se pierde si no hay conexión, el servidor está dormido o no hay sesión. */

const MAX_QUEUE = 50

// "12,30 €", "1.234,56 €", "€12.30", "1,234.56", "-4,50", "12" → número positivo.
// Devuelve null si no hay una cifra reconocible.
export function parseImporte(raw) {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0 ? Math.abs(raw) : null
  let s = String(raw).replace(/[\s  ]/g, '').replace(/[^\d.,-]/g, '').replace(/(?!^)-/g, '')
  s = s.replace(/^-/, '')
  if (!/\d/.test(s)) return null
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.')
  let decSep = null
  if (lastComma !== -1 && lastDot !== -1) decSep = lastComma > lastDot ? ',' : '.'
  else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.'
    const parts = s.split(sep)
    // Un único separador seguido de 1-2 cifras es decimal ("12,3", "4.50");
    // si no ("1.234", "1,234,567") es separador de miles.
    decSep = parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2 ? sep : null
  }
  let norm
  if (decSep) {
    const i = s.lastIndexOf(decSep)
    norm = s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1).replace(/[.,]/g, '')
  } else {
    norm = s.replace(/[.,]/g, '')
  }
  const n = Number(norm)
  if (!Number.isFinite(n) || n === 0) return null
  return Math.round(n * 100) / 100
}

// FNV-1a de 32 bits: suficiente para un identificador estable, no criptográfico.
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// Identificador del pago para que el backend detecte reenvíos: el `id` del Atajo
// si viene; si no, los parámetros + el minuto en que se recibió.
export function buildIdExterno({ id, importeTexto, comercio, fecha }, now = new Date()) {
  if (id) return String(id).slice(0, 120)
  const minute = Math.floor(now.getTime() / 60000)
  return `wallet-${hash([importeTexto, comercio || '', fecha || '', minute].join('|'))}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/

// Lee los parámetros del Atajo de una cadena de búsqueda ("?atajo=1&…").
// null si no es una URL del Atajo; { error } si falta o no se entiende el importe.
export function parseIntakeParams(search, now = new Date()) {
  const p = new URLSearchParams(search || '')
  if (p.get('atajo') !== '1') return null
  const importeTexto = (p.get('importe') || '').trim()
  const comercio = (p.get('comercio') || '').trim().slice(0, 120) || null
  const fechaRaw = (p.get('fecha') || '').trim()
  const fecha = DATE_RE.test(fechaRaw) ? fechaRaw.slice(0, 10) : null
  const id = (p.get('id') || '').trim() || null
  const importe = parseImporte(importeTexto)
  if (importe == null) return { error: 'importe', importeTexto, comercio }
  return {
    importe,
    importeTexto,
    comercio,
    fecha,
    fuente: 'wallet',
    id_externo: buildIdExterno({ id, importeTexto, comercio, fecha }, now),
    recibido: now.toISOString(),
  }
}

// Quita los parámetros del Atajo de la URL sin recargar (recargar no repite el pago).
export function cleanIntakeUrl() {
  try {
    const url = new URL(window.location.href)
    for (const k of ['atajo', 'importe', 'comercio', 'fecha', 'id']) url.searchParams.delete(k)
    const qs = url.searchParams.toString()
    window.history.replaceState(window.history.state, '', url.pathname + (qs ? `?${qs}` : '') + url.hash)
  } catch { /* no-op */ }
}

export function loadIntakeQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(SHORTCUT_QUEUE_KEY))
    return Array.isArray(q) ? q : []
  } catch { return [] }
}

function saveIntakeQueue(q) {
  try {
    if (q.length) localStorage.setItem(SHORTCUT_QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)))
    else localStorage.removeItem(SHORTCUT_QUEUE_KEY)
  } catch { /* no-op */ }
}

// Añade (o reinserta) un pago a la cola, sin duplicar por id_externo.
export function enqueueIntake(item) {
  const q = loadIntakeQueue()
  if (!q.some(x => x.id_externo === item.id_externo)) saveIntakeQueue([...q, item])
}

export function removeIntake(idExterno) {
  saveIntakeQueue(loadIntakeQueue().filter(x => x.id_externo !== idExterno))
}

// Si la URL actual viene del Atajo: la limpia y mete el pago en la cola.
// Devuelve { item } | { error } | null. Idempotente (tras limpiar no hay nada).
export function captureIntakeFromUrl(now = new Date()) {
  if (typeof window === 'undefined') return null
  const parsed = parseIntakeParams(window.location.search, now)
  if (!parsed) return null
  cleanIntakeUrl()
  if (parsed.error) return { error: parsed.error, importeTexto: parsed.importeTexto }
  enqueueIntake(parsed)
  return { item: parsed }
}

// Error de red / servidor dormido / sesión caducada → se reintenta más tarde.
// Errores de validación (4xx con mensaje) → no tiene sentido reintentar.
export function isRetryableError(e) {
  if (!e) return true
  if (e.name === 'TypeError' || e.name === 'TimeoutError' || e.name === 'AbortError') return true
  const msg = String(e.message || '')
  return /^API (5\d\d|429)$/.test(msg) || /demasiad|too many/i.test(msg) || /sesión ha caducado/i.test(msg) || /failed to fetch|network|load failed/i.test(msg)
}
