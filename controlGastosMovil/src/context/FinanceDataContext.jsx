import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { fetchFinanceData } from '../services/api'
import { FINANCE_CACHE_KEY } from '../utils/storageKeys'

const SSE_URL = (import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com') + '/api/events'

const LS_KEY = FINANCE_CACHE_KEY

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
    return raw ? splitUnreadable(JSON.parse(raw)).data : null
  } catch {
    return null
  }
}

function saveCache(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch {}
}

// Aviso para N movimientos que el servidor no pudo descifrar (null si no hay).
export function unreadableTxMsg(n) {
  const count = Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0
  if (count === 0) return null
  return count === 1
    ? 'No se ha podido leer 1 movimiento del servidor. Los totales pueden estar incompletos.'
    : `No se han podido leer ${count} movimientos del servidor. Los totales pueden estar incompletos.`
}

// Separa el recuento de ilegibles (estado del servidor, no dato del usuario:
// no se guarda en la caché). Un backend antiguo no lo envía: cuenta como 0.
export function splitUnreadable(result) {
  const { unreadable, ...rest } = result || {}
  const n = Number(unreadable)
  return { data: rest, unreadable: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 }
}

const Ctx = createContext(null)

export function FinanceDataProvider({ children }) {
  const [data, setData]               = useState(() => loadCache() ?? EMPTY)
  const [transactions, setTransactions] = useState(() => loadCache()?.transactions ?? [])
  const [status, setStatus]           = useState('idle')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [errorMsg, setErrorMsg]       = useState('')
  const [unreadable, setUnreadable]   = useState(0)

  // Al cerrar sesión el provider se desmonta; si había una petición en vuelo,
  // su respuesta no debe volver a escribir la caché que logout() acaba de borrar.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await fetchFinanceData()
      if (!aliveRef.current) return
      if (!result.configured) {
        setStatus('idle')
        setErrorMsg(result.error || '')
        return
      }
      const { data: clean, unreadable: n } = splitUnreadable(result)
      setData(clean)
      setTransactions(clean.transactions ?? [])
      setUnreadable(n)
      setLastUpdated(new Date())
      setStatus('live')
      setErrorMsg('')
      saveCache(clean)
    } catch (err) {
      if (!aliveRef.current) return
      // Mantiene los últimos datos guardados — no borra ni pone datos de ejemplo
      setStatus('offline')
      setErrorMsg(err.message)
      console.warn('[FinanceData] error al refrescar:', err.message)
    }
  }, [])

  // SSE: recibe notificación del backend cuando hay datos nuevos
  const sseRef = useRef(null)
  useEffect(() => {
    let closed = false
    let retryTimer = null
    function connectSSE() {
      if (closed) return
      const es = new EventSource(SSE_URL)
      sseRef.current = es

      es.addEventListener('update', () => {
        refresh()
        // Notifica a usePendingTransaction para que refresque la campana
        window.dispatchEvent(new Event('finance-update'))
      })

      es.onerror = () => {
        es.close()
        // Reintento con backoff de 5s si la conexión falla
        retryTimer = setTimeout(connectSSE, 5_000)
      }
    }

    connectSSE()

    return () => {
      // Sin esto, al cerrar sesión el reintento pendiente reabriría la conexión.
      closed = true
      clearTimeout(retryTimer)
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
    <Ctx.Provider value={{ data, transactions, status, lastUpdated, errorMsg, refresh, unreadableTx: unreadable }}>
      {children}
    </Ctx.Provider>
  )
}

export function useFinanceData() {
  return useContext(Ctx)
}
