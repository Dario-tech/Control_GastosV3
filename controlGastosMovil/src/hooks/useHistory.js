import { useState, useEffect } from 'react'
import { fetchCoinGeckoHistory, generateSynthetic } from '../services/historyApi'
import { fetchAVHistory } from '../services/alphaVantageApi'
import { useSettings } from '../context/SettingsContext'

export function useHistory(inv, currentPrice, days) {
  const { settings } = useSettings()
  const [points, setPoints] = useState([])
  const [source, setSource] = useState('loading') // 'loading' | 'live' | 'synthetic'

  useEffect(() => {
    if (!inv) return
    let cancelled = false
    setSource('loading')
    setPoints([])

    async function load() {
      try {
        let data
        if (inv.apiSource === 'coingecko') {
          data = await fetchCoinGeckoHistory(inv.apiId, days)
        } else if (inv.apiSource === 'yahoo') {
          if (!settings.avApiKey) throw new Error('sin-api-key')
          data = await fetchAVHistory(inv.avSymbol ?? inv.apiSymbol, settings.avApiKey, days)
        } else {
          const end   = inv.currentValue ?? inv.invested * 1.03
          const start = inv.invested
          data = generateSynthetic(start, end, days)
        }
        if (!cancelled) { setPoints(data); setSource('live') }
      } catch {
        const cp    = currentPrice ?? inv.avgBuyPrice * 1.05
        const start = inv.avgBuyPrice ?? cp * 0.9
        const synth = generateSynthetic(start, cp, days)
        if (!cancelled) { setPoints(synth); setSource('synthetic') }
      }
    }

    load()
    return () => { cancelled = true }
  }, [inv?.id, days, currentPrice, settings.avApiKey])

  return { points, source }
}
