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

// Categorías por defecto (comunes) + propias del usuario (vienen del servidor),
// sin las que el usuario tiene ocultas. `hidden` es una lista de
// { tipo, concepto }. Las propias que repiten el nombre de una por defecto
// no se duplican.
export function mergeCategories(custom = {}, hidden = []) {
  const hide = new Set((hidden || []).map(h => `${h.tipo}|${h.concepto}`))
  const result = {}
  for (const [tipo, defaults] of Object.entries(DEFAULT_CATEGORIES)) {
    const base = defaults.filter(c => !hide.has(`${tipo}|${c.concepto}`))
    const names = new Set(base.map(c => c.concepto))
    const extra = (custom[tipo] || []).filter(c => !names.has(c.concepto))
    result[tipo] = [...base, ...extra]
  }
  return result
}

export const EMOJI_SUGGESTIONS = [
  '💶','🎉','🍽️','👗','✈️','💪','📺','🏠','⚡','🔥',
  '🚿','📡','🚇','📈','₿','💊','🐾','🎮','🛍️','🚗',
  '📚','🏋️','🎬','🎁','🛒','🍕','☕','🐶','🎵','🏥',
]
