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

  // Al arrancar: guarda el importe de la URL si viene del Atajo, luego carga la cola
  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search)
      const amount = params.get('amount')
      if (amount) {
        const num = parseFloat(amount)
        window.history.replaceState({}, '', window.location.pathname)
        if (!isNaN(num) && num > 0) {
          try {
            await fetch(`${BASE}/api/pending`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body:    JSON.stringify({ importe: num }),
            })
          } catch { /* no-op */ }
        }
      }
      await fetchQueue()
    }
    init()
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
