// Claves de localStorage.
//
// Los datos del usuario (categorías propias, presupuestos, ajustes, categorías
// ocultas, tour visto) viven en el SERVIDOR. En el móvil solo hay:
//  - la sesión (AUTH_KEY) y la cola del Atajo (SHORTCUT_QUEUE_KEY);
//  - cachés desechables para pintar rápido (FINANCE_CACHE_KEY, CATS_CACHE_KEY,
//    PREFS_CACHE_KEY, avisos ya enviados);
//  - claves ANTIGUAS (LEGACY_*) con datos que aún pueden no estar en el
//    servidor. Solo se borran tras confirmar que el servidor los ha recibido
//    (utils/legacyImport.js). Nunca las borra el cierre de sesión ni el 401.
export const AUTH_KEY          = 'mi-economia-auth-v1'
export const FINANCE_CACHE_KEY = 'mi-economia-finance-cache-v1'
export const CATS_CACHE_KEY    = 'mi-economia-cats-cache-v2'
export const PREFS_CACHE_KEY   = 'mi-economia-prefs-cache-v2'
export const BUDGET_NOTIF_KEY  = 'mi-economia-notif-v1'
export const ANNUAL_NOTIF_KEY  = 'mi-economia-annual-notif-v1'
// Gastos recibidos del Atajo de iOS (Apple Pay) que aún no se han podido
// enviar al backend (sin conexión, servidor dormido o sin sesión iniciada).
export const SHORTCUT_QUEUE_KEY = 'mi-economia-shortcut-queue-v1'
// Movimientos de "Nuevo movimiento" que no se pudieron enviar por falta de
// conexión (se reintentan con el mismo id de cliente para no duplicar).
export const TX_QUEUE_KEY = 'mi-economia-tx-queue-v1'

// Claves antiguas pendientes de importar al servidor.
export const BUDGET_KEY        = 'mi-economia-budget-v3'
export const BUDGET_KEY_V2     = 'mi-economia-budget-v2'
export const BUDGET_KEY_V1     = 'mi-economia-budget-v1'
export const CUSTOM_CATS_KEY   = 'mi-economia-custom-cats-v1'
export const SETTINGS_KEY      = 'mi-economia-settings-v1'
export const TOUR_KEY          = 'mi-economia-tour-v1'

// Dueño (email) de las claves antiguas: se anota la primera vez que se ven
// tras un login. Solo ese usuario puede verlas e importarlas; para cualquier
// otro se ignoran y se conservan. Nunca la borra el cierre de sesión ni el 401.
export const LEGACY_OWNER_KEY  = 'mi-economia-legacy-owner-v1'

export const LEGACY_KEYS = [
  BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1, CUSTOM_CATS_KEY, SETTINGS_KEY, TOUR_KEY,
]

// Cierre de sesión: se borran la sesión y las cachés del usuario para que la
// siguiente persona del dispositivo no vea nada. NO toca las claves antiguas
// pendientes de importar (LEGACY_KEYS).
export const USER_DATA_KEYS = [
  AUTH_KEY,
  FINANCE_CACHE_KEY,
  CATS_CACHE_KEY,
  PREFS_CACHE_KEY,
  BUDGET_NOTIF_KEY,
  ANNUAL_NOTIF_KEY,
  SHORTCUT_QUEUE_KEY,
  TX_QUEUE_KEY,
]

// Sesión caducada (401): solo se pierde el token y la caché de finanzas.
export const SESSION_EXPIRED_KEYS = [AUTH_KEY, FINANCE_CACHE_KEY]

// Al entrar un usuario con otro email se borran las cachés de categorías y
// ajustes etiquetadas con el email de otra persona (llevan presupuestos en claro).
export function purgeForeignCaches(email) {
  if (!email) return
  for (const key of [CATS_CACHE_KEY, PREFS_CACHE_KEY]) {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) continue
      let tag
      try { tag = JSON.parse(raw)?.email } catch { tag = undefined }
      if (tag !== email) localStorage.removeItem(key)
    } catch { /* no-op */ }
  }
}

function removeAll(keys) {
  for (const key of keys) {
    try { localStorage.removeItem(key) } catch { /* no-op */ }
  }
}

export function clearUserData() { removeAll(USER_DATA_KEYS) }
export function clearExpiredSession() { removeAll(SESSION_EXPIRED_KEYS) }
