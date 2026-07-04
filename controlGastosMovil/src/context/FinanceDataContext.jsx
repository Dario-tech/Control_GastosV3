import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { fetchFinanceData } from '../services/api'

const SSE_URL = (import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com') + '/api/events'

const LS_KEY = 'mi-economia-finance-cache-v1'

const EMPTY = {
  year:             new Date().getFullYear(),
  activeMonths:     Array(12).fill(false),
  income:           [],
  fixedExpenses:    [],
  variableExpenses: [],
  transactions:     [],
}

function loadCache() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveCache(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch {}
}

const Ctx = createContext(null)

export function FinanceDataProvider({ children }) {
  const [data, setData]               = useState(() => loadCache() ?? EMPTY)
  const [transactions, setTransactions] = useState(() => loadCache()?.transactions ?? [])
  const [status, setStatus]           = useState('idle')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [errorMsg, setErrorMsg]       = useState('')

  const refresh = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await fetchFinanceData()
      if (!result.configured) {
        setStatus('idle')
        setErrorMsg(result.error || '')
        return
      }
      setData(result)
      setTransactions(result.transactions ?? [])
      setLastUpdated(new Date())
      setStatus('live')
      setErrorMsg('')
      saveCache(result)
    } catch (err) {
      // Mantiene los últimos datos guardados — no borra ni pone datos de ejemplo
      setStatus('offline')
      setErrorMsg(err.message)
      console.warn('[FinanceData] error al refrescar:', err.message)
    }
  }, [])

  // SSE: recibe notificación del backend cuando hay datos nuevos
  const sseRef = useRef(null)
  useEffect(() => {
    function connectSSE() {
      const es = new EventSource(SSE_URL)
      sseRef.current = es

      es.addEventListener('update', () => {
        refresh()
      })

      es.onerror = () => {
        es.close()
        // Reintento con backoff de 5s si la conexión falla
        setTimeout(connectSSE, 5_000)
      }
    }

    connectSSE()

    return () => {
      sseRef.current?.close()
    }
  }, [refresh])

  useEffect(() => {
    refresh()
    // Polling de respaldo cada 5 min (SSE es el canal principal)
    const interval = setInterval(refresh, 5 * 60_000)

    // Refresca al instante cuando el usuario vuelve a abrir la app
    function onVisible() {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return (
    <Ctx.Provider value={{ data, transactions, status, lastUpdated, errorMsg, refresh }}>
      {children}
    </Ctx.Provider>
  )
}

export function useFinanceData() {
  return useContext(Ctx)
}
