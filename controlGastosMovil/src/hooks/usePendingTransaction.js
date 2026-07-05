import { useState, useEffect, useCallback } from 'react'

const BASE   = import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com'
const LS_KEY = 'mi-economia-auth-v1'

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
      if (!res.ok) return
      setQueue(await res.json())
    } catch { /* no-op */ }
  }, [])

  useEffect(() => {
    fetchQueue()

    // Refresca al volver al frente (resume desde segundo plano en iOS)
    function onVisible() {
      if (document.visibilityState === 'visible') fetchQueue()
    }
    document.addEventListener('visibilitychange', onVisible)

    // Refresca cuando el backend notifica via SSE (Atajo ejecutado mientras la app estaba abierta)
    window.addEventListener('finance-update', fetchQueue)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('finance-update', fetchQueue)
    }
  }, [fetchQueue])

  async function categorizePending(id, tipo, concepto) {
    const res = await fetch(`${BASE}/api/pending/${id}/categorize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body:    JSON.stringify({ tipo, concepto }),
    })
    if (!res.ok) throw new Error('Error al categorizar')
    setQueue(q => q.filter(t => t.id !== id))
  }

  return { queue, fetchQueue, categorizePending }
}
