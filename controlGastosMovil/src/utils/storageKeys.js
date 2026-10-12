// Claves de localStorage con datos del usuario. Al cerrar sesión (o caducar)
// se borran todas, para que la siguiente persona que use el dispositivo no vea
// importes, presupuestos ni categorías de la anterior.
//
// No van aquí las preferencias de interfaz que no son personales (tema, acento,
// moneda en 'mi-economia-settings-v1', tour visto, calendario abierto): esas se
// conservan entre sesiones.
export const AUTH_KEY          = 'mi-economia-auth-v1'
export const FINANCE_CACHE_KEY = 'mi-economia-finance-cache-v1'
export const BUDGET_KEY        = 'mi-economia-budget-v3'
export const BUDGET_KEY_V2     = 'mi-economia-budget-v2'
export const BUDGET_KEY_V1     = 'mi-economia-budget-v1'
export const CUSTOM_CATS_KEY   = 'mi-economia-custom-cats-v1'
export const BUDGET_NOTIF_KEY  = 'mi-economia-notif-v1'
export const ANNUAL_NOTIF_KEY  = 'mi-economia-annual-notif-v1'

export const USER_DATA_KEYS = [
  AUTH_KEY,
  FINANCE_CACHE_KEY,
  BUDGET_KEY,
  BUDGET_KEY_V2,
  BUDGET_KEY_V1,
  CUSTOM_CATS_KEY,
  BUDGET_NOTIF_KEY,
  ANNUAL_NOTIF_KEY,
]

export function clearUserData() {
  for (const key of USER_DATA_KEYS) {
    try { localStorage.removeItem(key) } catch { /* no-op */ }
  }
}
