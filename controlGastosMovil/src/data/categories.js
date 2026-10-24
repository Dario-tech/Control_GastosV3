export const TYPES = [
  { id: 'Gasto Variable', label: 'Gasto Variable', emoji: '🛍️', color: 'var(--red)' },
  { id: 'Gasto Fijo',     label: 'Gasto Fijo',     emoji: '🏠', color: 'var(--orange)' },
  { id: 'Ingreso',        label: 'Ingreso',         emoji: '💼', color: 'var(--green)' },
]

export const DEFAULT_CATEGORIES = {
  'Gasto Variable': [
    { concepto: 'Ocio',                 emoji: '🎉' },
    { concepto: 'Comida',               emoji: '🍽️' },
    { concepto: 'Ropa',                 emoji: '👗' },
    { concepto: 'Vuelos',               emoji: '✈️' },
    { concepto: 'Gimnasio',             emoji: '💪' },
    { concepto: 'Suscripciones',        emoji: '📺' },
    { concepto: 'Variado',              emoji: '💶' },
  ],
  'Gasto Fijo': [
    { concepto: 'Piso',        emoji: '🏠' },
    { concepto: 'Luz',         emoji: '⚡' },
    { concepto: 'Gas',         emoji: '🔥' },
    { concepto: 'Agua',        emoji: '🚿' },
    { concepto: 'Wifi',        emoji: '📡' },
    { concepto: 'Transporte',  emoji: '🚇' },
    { concepto: 'Inversiones', emoji: '📈' },
    { concepto: 'Cripto',      emoji: '₿'  },
  ],
  'Ingreso': [
    { concepto: 'Nómina',        emoji: '💼' },
    { concepto: 'Otros motivos', emoji: '🎁' },
  ],
}

// Nombre de categoría para comparar: sin espacios sobrantes, sin distinguir
// mayúsculas ni acentos ("  Gimnásio " == "gimnasio").
export function normalizeCategoryName(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase()
}

// Clave estable y única por tipo para listas de React y comparaciones.
export function categoryKey(tipo, concepto) {
  return `${tipo}|${normalizeCategoryName(concepto)}`
}

// Une las categorías por defecto de un tipo con las propias del usuario.
// Si una propia coincide (nombre normalizado) con una por defecto se muestra
// una sola: el nombre de la por defecto con el emoji de la propia. Las propias
// repetidas entre sí tampoco se duplican (gana la primera).
export function combineCategories(defaults = [], custom = []) {
  const out = []
  const index = new Map()
  for (const c of defaults || []) {
    const k = normalizeCategoryName(c.concepto)
    if (!k || index.has(k)) continue
    index.set(k, out.length)
    out.push(c)
  }
  const nDefaults = out.length
  const recolored = new Set()   // por defecto que ya tomó el emoji de una propia
  for (const c of custom || []) {
    const k = normalizeCategoryName(c.concepto)
    if (!k) continue
    if (index.has(k)) {
      const i = index.get(k)
      if (i < nDefaults && c.emoji && !recolored.has(k)) {
        out[i] = { ...out[i], emoji: c.emoji }
        recolored.add(k)
      }
      continue
    }
    index.set(k, out.length)
    out.push(c)
  }
  return out
}

// ¿Ya hay una categoría con ese nombre (normalizado) en la lista?
export function categoryExists(list, concepto) {
  const k = normalizeCategoryName(concepto)
  return !!k && (list || []).some(c => normalizeCategoryName(c.concepto) === k)
}

// Categorías por defecto (comunes) + propias del usuario (vienen del servidor),
// sin las que el usuario tiene ocultas. `hidden` es una lista de
// { tipo, concepto }. Las propias que repiten el nombre de una por defecto
// no se duplican.
export function mergeCategories(custom = {}, hidden = []) {
  const hide = new Set((hidden || []).map(h => categoryKey(h.tipo, h.concepto)))
  const result = {}
  for (const [tipo, defaults] of Object.entries(DEFAULT_CATEGORIES)) {
    const base = defaults.filter(c => !hide.has(categoryKey(tipo, c.concepto)))
    result[tipo] = combineCategories(base, custom[tipo] || [])
  }
  return result
}

export const EMOJI_SUGGESTIONS = [
  '💶','🎉','🍽️','👗','✈️','💪','📺','🏠','⚡','🔥',
  '🚿','📡','🚇','📈','₿','💊','🐾','🎮','🛍️','🚗',
  '📚','🏋️','🎬','🎁','🛒','🍕','☕','🐶','🎵','🏥',
]
