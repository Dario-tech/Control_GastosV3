import { fmt } from './index'

// Máscara que sustituye a una cifra monetaria cuando «Ocultar importes» está
// activo. Se usa donde no vale el desenfoque por CSS (tooltips y ejes de
// recharts, etiquetas SVG).
export const AMOUNT_MASK = '•••'

/** `fmt(n)` o la máscara si `hide`. */
export function fmtAmount(n, hide, decimals = 0) {
  return hide ? AMOUNT_MASK : fmt(n, decimals)
}

/** Texto ya formateado o la máscara si `hide`. */
export function maskAmount(text, hide) {
  return hide ? AMOUNT_MASK : text
}

/** Formateador de eje Y compacto (1k, 2k…) o vacío si `hide`. */
export function axisTick(hide) {
  // Un decimal solo si hace falta (2400 -> "2,4k"): con toFixed(0) dos marcas
  // distintas (1600 y 2400) se pintaban ambas como "2k".
  return hide ? () => '' : v => (v >= 1000 ? `${String(Math.round(v / 100) / 10).replace('.', ',')}k` : v)
}
