import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { DATA as MOCK_DATA } from '../data/mockData'
import { fetchFinanceData } from '../services/api'

const Ctx = createContext(null)

export function FinanceDataProvider({ children }) {
  const [data, setData] = useState(MOCK_DATA)
  const [transactions, setTransactions] = useState([])
  const [status, setStatus] = useState('idle')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const hasRealData = useRef(false) // una vez que llegan datos reales, no volver a mock

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
      hasRealData.current = true
    } catch (err) {
      // Si ya teníamos datos reales, los conservamos — solo mostramos el estado de error
      if (!hasRealData.current) setData(MOCK_DATA)
      setStatus('offline')
      setErrorMsg(err.message)
      console.warn('[FinanceData] error al refrescar:', err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10_000) // refresca cada 10 s
    return () => clearInterval(interval)
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
