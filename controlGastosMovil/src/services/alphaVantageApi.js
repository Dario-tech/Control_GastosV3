// Alpha Vantage - gratuita, CORS nativo, accesible desde red corporativa
// Registro gratuito: https://www.alphavantage.co/support/#api-key
// Free tier: 25 peticiones/día, 5/minuto

const AV_BASE = 'https://www.alphavantage.co/query'

// Caché en memoria: evita repetir peticiones al cambiar rango en el modal
const _historyCache = {}

export async function fetchAVPrice(avSymbol, apiKey) {
  const url = `${AV_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(avSymbol)}&apikey=${apiKey}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`AV ${res.status}`)
  const json = await res.json()

  if (json.Note)        throw new Error('AV: límite de peticiones alcanzado')
  if (json.Information) throw new Error('AV: ' + json.Information)

  const q = json['Global Quote']
  if (!q || !q['05. price']) throw new Error('AV: símbolo no encontrado — verifica el ticker')

  const price  = parseFloat(q['05. price'])
  const change = parseFloat((q['10. change percent'] ?? '0').replace('%', ''))
  return { price, change }
}

export async function fetchAVHistory(avSymbol, apiKey, days) {
  const key = `${avSymbol}|${apiKey}`
  const now  = Date.now()
  const TTL  = 60 * 60 * 1000 // 1 hora

  if (!_historyCache[key] || now - _historyCache[key].at > TTL) {
    const size = days > 100 ? 'full' : 'compact'
    const url  = `${AV_BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(avSymbol)}&outputsize=${size}&apikey=${apiKey}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`AV history ${res.status}`)
    const json = await res.json()

    if (json.Note)        throw new Error('AV: límite de peticiones — espera 1 minuto')
    if (json.Information) throw new Error('AV: ' + json.Information)

    const timeSeries = json['Time Series (Daily)']
    if (!timeSeries)      throw new Error('AV: sin datos históricos para ' + avSymbol)

    _historyCache[key] = { at: now, data: timeSeries }
  }

  const cutoff = now - days * 86_400_000
  return Object.entries(_historyCache[key].data)
    .map(([date, v]) => ({
      ts:    new Date(date).getTime(),
      price: parseFloat(v['4. close']),
    }))
    .filter(d => d.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts)
}
