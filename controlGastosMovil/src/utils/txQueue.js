import { TX_QUEUE_KEY } from './storageKeys'
import { postTransaction } from '../services/api'

/* Cola de movimientos sin enviar ("Nuevo movimiento" sin conexión).

   Mismo patrón que utils/shortcutIntake.js: si el POST falla por red/timeout/
   servidor dormido, el movimiento se guarda en localStorage con su id de
   cliente y se reintenta al volver 'online' y al abrir la app. El id es el
   mismo en cada reintento, así que un envío que en realidad llegó al servidor
   no se duplica. Los errores 4xx (validación) NO se encolan. */

const MAX_QUEUE = 50

export const MSG_OFFLINE  = 'Sin conexión: se guardará cuando vuelva'
export const MSG_SESSION  = 'Tu sesión ha caducado. Vuelve a iniciar sesión.'
export const MSG_REJECTED = 'El servidor ha rechazado el movimiento. Revisa el importe y los datos.'
export const MSG_SERVER   = 'Error al guardar. Inténtalo de nuevo.'

// 'session' (401) | 'rejected' (4xx de validación) | 'offline' (red, timeout,
// 5xx o 429: se puede reintentar tal cual) | 'unknown'.
export function classifyTxError(e) {
  if (e?.status === 401 || /sesión ha caducado/i.test(String(e?.message || ''))) return 'session'
  if (typeof e?.status === 'number') {
    if (e.status === 429 || e.status >= 500) return 'offline'
    if (e.status >= 400) return 'rejected'
  }
  const msg = String(e?.message || '')
  if (/^API (5\d\d|429)$/.test(msg)) return 'offline'
  if (/^API 4\d\d$/.test(msg)) return 'rejected'
  if (e?.name === 'TypeError' || e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'offline'
  if (/failed to fetch|network|load failed/i.test(msg)) return 'offline'
  return 'unknown'
}

// Mensaje de error para mostrar en el formulario (distinto por causa).
export function txErrorMessage(e) {
  switch (classifyTxError(e)) {
    case 'session':  return MSG_SESSION
    case 'rejected': {
      const m = String(e?.message || '')
      return m && !/^API \d+$/.test(m) ? `${MSG_REJECTED} (${m})` : MSG_REJECTED
    }
    case 'offline':  return MSG_OFFLINE
    default:         return MSG_SERVER
  }
}

export function loadTxQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(TX_QUEUE_KEY))
    return Array.isArray(q) ? q : []
  } catch { return [] }
}

function saveTxQueue(q) {
  try {
    if (q.length) localStorage.setItem(TX_QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)))
    else localStorage.removeItem(TX_QUEUE_KEY)
  } catch { /* no-op */ }
}

// item: { id, importe, tipo, concepto, fecha, comentario }. Sin duplicar por id.
export function enqueueTx(item) {
  const q = loadTxQueue()
  if (!item?.id || q.some(x => x.id === item.id)) return
  saveTxQueue([...q, { ...item, creado: item.creado || new Date().toISOString() }])
}

export function removeTx(id) {
  saveTxQueue(loadTxQueue().filter(x => x.id !== id))
}

// Cerrojo de módulo: StrictMode y varios eventos a la vez no deben lanzar dos
// envíos en paralelo de la misma cola.
let flushing = false

/** Reintenta la cola en orden. Se detiene ante un error reintentable o un 401
 *  (el movimiento se conserva). Un 4xx descarta ese movimiento.
 *  Devuelve { sent, dropped, pending }. */
export async function flushTxQueue({ send = postTransaction } = {}) {
  const result = { sent: 0, dropped: 0, pending: loadTxQueue().length }
  if (flushing || !result.pending) return result
  flushing = true
  try {
    for (const item of loadTxQueue()) {
      try {
        await send(item.importe, item.tipo, item.concepto, item.fecha, item.comentario ?? null, item.id)
        removeTx(item.id)
        result.sent++
      } catch (e) {
        const kind = classifyTxError(e)
        if (kind === 'rejected') { removeTx(item.id); result.dropped++; continue }
        break // sin conexión, servidor caído o sesión caducada: se reintenta luego
      }
    }
  } finally {
    flushing = false
  }
  result.pending = loadTxQueue().length
  return result
}
