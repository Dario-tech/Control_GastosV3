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
  return hide ? () => '' : v => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)
}
