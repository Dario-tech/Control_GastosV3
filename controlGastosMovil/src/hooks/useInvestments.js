import { useState, useEffect, useCallback } from 'react'
import { INVESTMENTS } from '../data/investmentData'
import { fetchAllPrices } from '../services/investmentApi'

export function useInvestments() {
  const [prices, setPrices] = useState({})
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [lastUpdated, setLastUpdated] = useState(null)

  const refresh = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await fetchAllPrices(INVESTMENTS)
      setPrices(result)
      setLastUpdated(new Date())
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }, [])

  // Carga automática al montar
  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 60_000) // refresca cada 60 s
    return () => clearInterval(interval)
  }, [refresh])

  // Calcular valor actual de una inversión
  function getValue(inv) {
    const p = prices[inv.id]
    if (!p) return null
    // Para PIAS usamos el currentValue estático actualizado por el rendimiento
    if (inv.apiSource === 'static' && inv.currentValue) {
      return { currentValue: inv.currentValue, returnPct: inv.annualReturn }
    }
    const currentValue = (inv.units ?? 1) * p.price
    const returnPct = inv.invested > 0 ? ((currentValue - inv.invested) / inv.invested) * 100 : 0
    return { currentValue, returnPct }
  }

  // Totales del portfolio
  function getTotals() {
    const allInv = [
      ...INVESTMENTS.longTerm,
      ...INVESTMENTS.shortTerm,
      ...INVESTMENTS.pias,
    ]
    let totalInvested = 0
    let totalCurrent  = 0
    allInv.forEach(inv => {
      totalInvested += inv.invested
      const v = getValue(inv)
      totalCurrent += v ? v.currentValue : inv.invested
    })
    const totalReturn = totalInvested > 0
      ? ((totalCurrent - totalInvested) / totalInvested) * 100
      : 0
    return { totalInvested, totalCurrent, totalReturn }
  }

  return { prices, status, lastUpdated, refresh, getValue, getTotals }
}
