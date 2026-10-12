import { useState, useEffect, useCallback } from 'react'
import { SESSION_EXPIRED_EVENT } from '../services/api'
import { AUTH_KEY as LS_KEY } from '../utils/storageKeys'

const BASE   = import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com'

function authHeaders() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY))
    if (stored?.sessionToken) return { Authorization: `Bearer ${stored.sessionToken}` }
  } catch { /* no-op */ }
  return {}
}

export function usePendingTransaction() {
  const [queue, setQueue] = useState([])

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/pending`, { headers: authHeaders() })
      if (res.status === 401) {
        try { localStorage.removeItem(LS_KEY) } catch { /* no-op */ }
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
        return
      }
      if (!res.ok) return
      setQueue(await res.json())
    } catch { /* no-op */ }
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

  async function categorizePending(id, tipo, concepto) {
    const res = await fetch(`${BASE}/api/pending/${id}/categorize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body:    JSON.stringify({ tipo, concepto }),
    })
    if (res.status === 401) {
      try { localStorage.removeItem(LS_KEY) } catch { /* no-op */ }
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.')
    }
    if (!res.ok) throw new Error('Error al categorizar')
    setQueue(q => q.filter(t => t.id !== id))
  }

  return { queue, fetchQueue, categorizePending }
}
