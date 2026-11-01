// Moneda de la app. Solo cambia el símbolo/formato: los importes NO se convierten.
// SettingsProvider llama a setCurrency() con el ajuste del usuario y fmt() lo lee.
export const CURRENCIES = ['EUR', 'USD', 'GBP']

let current = 'EUR'
const cache = new Map()

export function normalizeCurrency(code) {
  return CURRENCIES.includes(code) ? code : 'EUR'
}

export function setCurrency(code) {
  current = normalizeCurrency(code)
}

export function getCurrency() {
  return current
}

/** Símbolo corto de la moneda activa ("€", "$", "£"). */
export function currencySymbol(code = current) {
  return { EUR: '€', USD: '$', GBP: '£' }[normalizeCurrency(code)]
}

/** Formatea `n` con la moneda activa (formato español, símbolo estrecho). */
export function formatMoney(n, decimals = 0) {
  const key = `${current}|${decimals}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: current,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    cache.set(key, f)
  }
  return f.format(n)
}
