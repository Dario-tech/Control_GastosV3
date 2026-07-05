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
    { concepto: 'Netflix&Dazn&Regalos', emoji: '📺' },
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

export const EMOJI_SUGGESTIONS = [
  '💶','🎉','🍽️','👗','✈️','💪','📺','🏠','⚡','🔥',
  '🚿','📡','🚇','📈','₿','💊','🐾','🎮','🛍️','🚗',
  '📚','🏋️','🎬','🎁','🛒','🍕','☕','🐶','🎵','🏥',
]
