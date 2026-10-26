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

// Tiempos (exportados para los tests)
export const SSE_DEBOUNCE_MS = 2_000
export const SSE_BACKOFF_MIN_MS = 5_000
export const SSE_BACKOFF_MAX_MS = 60_000
export const FINANCE_POLL_MS = 5 * 60_000
export const FINANCE_MIN_GAP_MS = 20_000

const isVisible = () => document.visibilityState !== 'hidden'

export function FinanceDataProvider({ children }) {
  // La caché se lee y parsea una sola vez al montar
  const [initial] = useState(loadCache)
  const [data, setData]               = useState(initial ?? EMPTY)
  const [transactions, setTransactions] = useState(initial?.transactions ?? [])
  const [status, setStatus]           = useState('idle')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [errorMsg, setErrorMsg]       = useState('')
  const [unreadable, setUnreadable]   = useState(0)

  // Al cerrar sesión el provider se desmonta; si había una petición en vuelo,
  // su respuesta no debe volver a escribir la caché que logout() acaba de borrar.
  const aliveRef = useRef(true)
  const ctlRef      = useRef(null)   // AbortController de la petición en vuelo
  const seqRef      = useRef(0)      // número de la última petición lanzada
  const queuedRef   = useRef(false)  // hay una recarga pendiente tras la actual
  const dirtyRef    = useRef(false)  // llegó un aviso con la app oculta
  const lastLoadRef = useRef(0)

  // Carga forzada: cancela la petición anterior (puede ser anterior a un cambio
  // del usuario) y solo la respuesta más reciente escribe el estado.
  const refresh = useCallback(async () => {
    ctlRef.current?.abort()
    const ctl = new AbortController()
    ctlRef.current = ctl
    const seq = ++seqRef.current
    const stale = () => !aliveRef.current || seq !== seqRef.current || ctl.signal.aborted
    lastLoadRef.current = Date.now()
    dirtyRef.current = false
    setStatus('loading')
    try {
      const result = await fetchFinanceData({ signal: ctl.signal })
      if (stale()) return
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
      if (stale()) return
      // Mantiene los últimos datos guardados — no borra ni pone datos de ejemplo
      setStatus('offline')
      setErrorMsg(err.message)
      console.warn('[FinanceData] error al refrescar:', err.message)
    } finally {
      if (ctlRef.current === ctl) {
        ctlRef.current = null
        // Si durante la petición llegaron más avisos, UNA recarga más
        if (queuedRef.current && aliveRef.current) {
          queuedRef.current = false
          requestRefreshRef.current()
        }
      }
    }
  }, [])

  // Recarga "educada" (avisos SSE, sondeo, volver a primer plano): no recarga
  // con la app oculta (marca sucio), y si ya hay una en curso encola una sola más.
  const requestRefreshRef = useRef(() => {})
  requestRefreshRef.current = () => {
    if (!aliveRef.current) return
    if (!isVisible()) { dirtyRef.current = true; return }
    if (ctlRef.current) { queuedRef.current = true; return }
    refresh()
  }

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      ctlRef.current?.abort()
    }
  }, [])

  // SSE: recibe notificación del backend cuando hay datos nuevos
  const sseRef = useRef(null)
  useEffect(() => {
    let closed = false
    let retryTimer = null
    let debounceTimer = null
    let backoff = SSE_BACKOFF_MIN_MS

    function disconnect() {
      clearTimeout(retryTimer)
      retryTimer = null
      const es = sseRef.current
      sseRef.current = null
      if (es) { es.onerror = null; es.close() }
    }

    function connectSSE() {
      if (closed || sseRef.current || !isVisible()) return
      const es = new EventSource(SSE_URL)
      sseRef.current = es

      es.onopen = () => { backoff = SSE_BACKOFF_MIN_MS }

      es.addEventListener('update', () => {
        // Varios avisos seguidos = una sola recarga de finanzas y una de pendientes
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          debounceTimer = null
          if (closed) return
          if (!isVisible()) { dirtyRef.current = true; return }
          requestRefreshRef.current()
          // Notifica a usePendingTransaction para que refresque la campana
          window.dispatchEvent(new Event('finance-update'))
        }, SSE_DEBOUNCE_MS)
      })

      es.onerror = () => {
        es.close()
        if (sseRef.current === es) sseRef.current = null
        if (closed || !isVisible()) return
        // Reintento con backoff exponencial 5 s → 60 s
        const wait = backoff
        backoff = Math.min(backoff * 2, SSE_BACKOFF_MAX_MS)
        retryTimer = setTimeout(connectSSE, wait)
      }
    }

    function onVisibility() {
      if (isVisible()) {
        backoff = SSE_BACKOFF_MIN_MS
        connectSSE()
      } else {
        disconnect()   // con la app oculta no se mantiene la conexión
      }
    }

    connectSSE()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      // Sin esto, al cerrar sesión el reintento pendiente reabriría la conexión.
      closed = true
      clearTimeout(debounceTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      disconnect()
    }
  }, [])

  useEffect(() => {
    refresh()
    // Polling de respaldo cada 5 min (SSE es el canal principal)
    const interval = setInterval(() => requestRefreshRef.current(), FINANCE_POLL_MS)

    // Al volver a abrir la app: recarga si llegó algo mientras estaba oculta
    // o si los datos tienen cierta antigüedad.
    function onVisible() {
      if (!isVisible()) return
      if (dirtyRef.current || Date.now() - lastLoadRef.current > FINANCE_MIN_GAP_MS) {
        requestRefreshRef.current()
      }
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
