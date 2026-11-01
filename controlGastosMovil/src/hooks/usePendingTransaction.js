import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchPending,
  categorizePending as apiCategorizePending,
  discardPending as apiDiscardPending,
} from '../services/api'

export const PENDING_POLL_MS = 3 * 60_000
export const PENDING_MIN_GAP_MS = 20_000

// Cola de pagos pendientes de categorizar (Apple Pay vía Atajo de iOS, u otros
// orígenes). El 401 lo gestiona apiJson en services/api.js (cierra la sesión).
export function usePendingTransaction() {
  const [queue, setQueue] = useState([])

  const lastRunRef  = useRef(0)
  const inflightRef = useRef(false)

  const fetchQueue = useCallback(async () => {
    if (inflightRef.current) return
    inflightRef.current = true
    lastRunRef.current = Date.now()
    try {
      const list = await fetchPending()
      if (Array.isArray(list)) setQueue(list)
    } catch { /* no-op: sin red o backend dormido, se reintenta luego */ }
    finally { inflightRef.current = false }
  }, [])

  useEffect(() => {
    const visible = () => document.visibilityState === 'visible'
    // Al volver a primer plano: una sola vez, con un mínimo entre refrescos
    function refreshIfStale() {
      if (!visible()) return
      if (Date.now() - lastRunRef.current < PENDING_MIN_GAP_MS) return
      fetchQueue()
    }

    fetchQueue()

    function onVisible() { refreshIfStale() }
    // pageshow: más fiable que visibilitychange en iOS PWA (incluye bfcache restore).
    // Si ya saltó visibilitychange, el mínimo entre refrescos evita la segunda petición.
    function onPageShow() { refreshIfStale() }
    // Aviso SSE (ya con debounce en FinanceDataContext): una petición por ráfaga.
    function onUpdate() { if (visible()) fetchQueue() }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('finance-update', onUpdate)

    // Sondeo de respaldo cada 3 min, solo con la pestaña visible
    const poll = setInterval(() => { if (visible()) fetchQueue() }, PENDING_POLL_MS)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('finance-update', onUpdate)
      clearInterval(poll)
    }
  }, [fetchQueue])

  // opts: { recordar = true, comentario } — recordar enseña al backend que este
  // comercio va a esta categoría.
  const categorizePending = useCallback(async (id, tipo, concepto, opts = {}) => {
    await apiCategorizePending(id, { tipo, concepto, recordar: opts.recordar ?? true, comentario: opts.comentario })
    setQueue(q => q.filter(t => t.id !== id))
  }, [])

  const discardPending = useCallback(async id => {
    await apiDiscardPending(id)
    setQueue(q => q.filter(t => t.id !== id))
  }, [])

  return { queue, fetchQueue, categorizePending, discardPending }
}
