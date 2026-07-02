import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchFinanceData } from '../services/api'

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

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 60_000)

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
