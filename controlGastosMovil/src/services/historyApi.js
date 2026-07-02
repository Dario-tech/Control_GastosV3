export const RANGES = [
  { label: '1S',  days: 7    },
  { label: '1M',  days: 30   },
  { label: '3M',  days: 90   },
  { label: '6M',  days: 180  },
  { label: '1A',  days: 365  },
  { label: 'MAX', days: 1825 },
]

export async function fetchCoinGeckoHistory(coinId, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=eur&days=${days}&precision=2`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error('coingecko-error')
  const json = await res.json()
  return json.prices.map(([ts, price]) => ({
    ts,
    price: Math.round(price * 100) / 100,
  }))
}

const CORS_PROXY = 'https://corsproxy.io/?'

export async function fetchYahooHistory(symbol, days) {
  const rangeMap = { 7: '5d', 30: '1mo', 90: '3mo', 180: '6mo', 365: '1y', 1825: '5y' }
  const range    = rangeMap[days] ?? '1y'
  const interval = days <= 30 ? '1d' : '1wk'
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`
  const res = await fetch(CORS_PROXY + target, { signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error('yahoo-error')
  const json = await res.json()
  const result = json.chart.result?.[0]
  if (!result) throw new Error('no-data')
  const timestamps = result.timestamp
  const closes     = result.indicators.quote[0].close
  return timestamps
    .map((ts, i) => ({ ts: ts * 1000, price: closes[i] }))
    .filter(d => d.price != null)
    .map(d => ({ ts: d.ts, price: Math.round(d.price * 100) / 100 }))
}

export function generateSynthetic(startPrice, endPrice, days) {
  const points = Math.min(days, 100)
  const now    = Date.now()
  const result = []
  let price    = startPrice

  for (let i = 0; i <= points; i++) {
    const t       = i / points
    const target  = startPrice + (endPrice - startPrice) * t
    const noise   = price * 0.018 * (Math.random() - 0.5)
    price         = price + (target - price) * 0.2 + noise
    price         = Math.max(price, startPrice * 0.4)
    const msAgo   = (points - i) * (days / points) * 86_400_000
    result.push({ ts: now - msAgo, price: Math.round(price * 100) / 100 })
  }
  return result
}
