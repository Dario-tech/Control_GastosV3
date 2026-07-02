import { FALLBACK_PRICES } from '../data/investmentData'
import { fetchPrices } from './api'

export async function fetchAllPrices(investments) {
  try {
    const prices = await fetchPrices()
    // Mapear resultado del backend al formato que espera useInvestments
    const all = [...investments.longTerm, ...investments.shortTerm, ...investments.pias]
    const priceMap = {}
    all.forEach(inv => {
      if (inv.apiSource === 'static') {
        priceMap[inv.id] = { price: inv.staticPrice ?? 1, change: inv.staticChange ?? 0, source: 'static' }
        return
      }
      const p = prices[inv.id]
      if (p && p.source === 'live') {
        priceMap[inv.id] = p
      } else {
        const fallback = FALLBACK_PRICES[inv.apiSymbol ?? inv.apiId]
        priceMap[inv.id] = fallback
          ? { ...fallback, source: 'fallback' }
          : { price: inv.avgBuyPrice ?? 0, change: 0, source: 'offline' }
      }
    })
    return priceMap
  } catch {
    // Backend no disponible → usar fallbacks
    const all = [...investments.longTerm, ...investments.shortTerm, ...investments.pias]
    const priceMap = {}
    all.forEach(inv => {
      if (inv.apiSource === 'static') {
        priceMap[inv.id] = { price: inv.staticPrice ?? 1, change: inv.staticChange ?? 0, source: 'static' }
        return
      }
      const fallback = FALLBACK_PRICES[inv.apiSymbol ?? inv.apiId]
      priceMap[inv.id] = fallback
        ? { ...fallback, source: 'fallback' }
        : { price: inv.avgBuyPrice ?? 0, change: 0, source: 'offline' }
    })
    return priceMap
  }
}
