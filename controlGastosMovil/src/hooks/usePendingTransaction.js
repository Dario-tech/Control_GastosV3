import { useState, useEffect, useCallback } from 'react'
import {
  fetchPending,
  categorizePending as apiCategorizePending,
  discardPending as apiDiscardPending,
} from '../services/api'

// Cola de pagos pendientes de categorizar (Apple Pay vía Atajo de iOS, u otros
// orígenes). El 401 lo gestiona apiJson en services/api.js (cierra la sesión).
export function usePendingTransaction() {
  const [queue, setQueue] = useState([])

  const fetchQueue = useCallback(async () => {
    try {
      const list = await fetchPending()
      if (Array.isArray(list)) setQueue(list)
    } catch { /* no-op: sin red o backend dormido, se reintenta luego */ }
  }, [])

  useEffect(() => {
    fetchQueue()

    // visibilitychange: app vuelve al frente en Android / escritorio
    function onVisible() {
      if (document.visibilityState === 'visible') fetchQueue()
    }
    // pageshow: más fiable que visibilitychange en iOS PWA (incluye bfcache restore)
    function onPageShow(e) {
      if (e.persisted || document.visibilityState === 'visible') fetchQueue()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('finance-update', fetchQueue)

    // Polling cada 30s: fallback para cuando SSE no llega (Render free tier duerme)
    const poll = setInterval(fetchQueue, 30_000)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('finance-update', fetchQueue)
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
