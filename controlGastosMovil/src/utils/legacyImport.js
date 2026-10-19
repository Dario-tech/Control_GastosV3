// Importación ÚNICA de los datos que antes vivían solo en el móvil
// (categorías propias, presupuestos, ajustes, tour visto y la regla fija de
// categorías ocultas) a las preferencias del servidor.
//
// Reglas (protegen datos que a veces solo existen en el dispositivo):
//  - Una clave antigua se borra SOLO después de que el servidor haya
//    respondido bien (o de confirmar que ya tiene ese dato: el servidor gana).
//  - Ante error, 404 (backend sin desplegar) o falta de red no se borra nada;
//    se reintenta en la siguiente carga. Es idempotente.
import {
  BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1, CUSTOM_CATS_KEY, SETTINGS_KEY, TOUR_KEY,
} from './storageKeys'
import { autoColor } from './budget'
import { DEFAULT_CATEGORIES } from '../data/categories'

const TIPOS = Object.keys(DEFAULT_CATEGORIES)
const IMPORT_CHUNK = 200

// Regla antigua (antes HIDDEN_CATEGORIES_BY_USER en data/categories.js): se
// aplica una sola vez por usuario para calcular su lista de ocultas y subirla.
const LEGACY_HIDDEN_RULES = [
  { match: name => name?.toLowerCase().startsWith('julia'), hide: ['Inversiones', 'Cripto'] },
]

export function legacyHiddenFor(name) {
  const hide = new Set(LEGACY_HIDDEN_RULES.filter(r => r.match(name)).flatMap(r => r.hide))
  const out = []
  for (const [tipo, cats] of Object.entries(DEFAULT_CATEGORIES)) {
    for (const c of cats) if (hide.has(c.concepto)) out.push({ tipo, concepto: c.concepto })
  }
  return out
}

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key)
    return raw == null ? undefined : JSON.parse(raw)
  } catch {
    return null // presente pero ilegible
  }
}

// Categorías antiguas como lista plana [{tipo, concepto, emoji}].
// undefined = no hay clave; null = clave ilegible.
export function readLegacyCats(storage = localStorage) {
  const data = readJson(storage, CUSTOM_CATS_KEY)
  if (data === undefined || data === null) return data
  if (typeof data !== 'object' || Array.isArray(data)) return null
  const items = []
  for (const tipo of TIPOS) {
    for (const c of Array.isArray(data[tipo]) ? data[tipo] : []) {
      const concepto = typeof c?.concepto === 'string' ? c.concepto.trim() : ''
      if (concepto) items.push({ tipo, concepto, emoji: c.emoji || undefined })
    }
  }
  return items
}

// Presupuestos antiguos (cadena v3, o v2/v1 migrados en memoria, sin escribir).
// undefined = no hay ninguna clave; null = ilegible.
export function readLegacyBudgets(storage = localStorage) {
  const v3 = readJson(storage, BUDGET_KEY)
  if (v3 !== undefined) return Array.isArray(v3) ? v3 : null
  const month = new Date().getMonth()
  const v2 = readJson(storage, BUDGET_KEY_V2)
  if (v2 !== undefined) {
    return Array.isArray(v2) ? v2.map((it, i) => ({ ...it, color: it.color || autoColor(i), month })) : null
  }
  const v1 = readJson(storage, BUDGET_KEY_V1)
  if (v1 !== undefined) {
    return Array.isArray(v1) ? v1.map((it, i) => ({ ...it, color: autoColor(i), month })) : null
  }
  return undefined
}

export function readLegacySettings(storage = localStorage) {
  const s = readJson(storage, SETTINGS_KEY)
  return s && typeof s === 'object' && !Array.isArray(s) ? s : undefined
}

export function hasLegacyTour(storage = localStorage) {
  try { return storage.getItem(TOUR_KEY) != null } catch { return false }
}

function drop(storage, ...keys) {
  for (const k of keys) { try { storage.removeItem(k) } catch { /* no-op */ } }
}

/**
 * @param user     { name } del usuario con sesión
 * @param prefs    respuesta de GET /api/prefs, o null si no se pudo leer
 *                 (entonces solo se importan las categorías)
 * @param api      { importCategories(items), putPref(kind, data) }
 * @returns { categories, applied, failed }
 *   categories: lista del servidor tras importar (o null si no hubo import)
 *   applied:    { kind: dato } lo que se acaba de subir (ya es del servidor)
 *   failed:     nombres de lo que quedó pendiente para el siguiente intento
 */
export async function importLegacy({ user, prefs, api, storage = localStorage }) {
  const out = { categories: null, applied: {}, failed: [] }

  // 1. Categorías propias
  try {
    const items = readLegacyCats(storage)
    if (items === null) {
      out.failed.push('categories') // ilegible: no se toca
    } else if (Array.isArray(items)) {
      if (items.length === 0) {
        drop(storage, CUSTOM_CATS_KEY)
      } else {
        let last = null
        for (let i = 0; i < items.length; i += IMPORT_CHUNK) {
          const res = await api.importCategories(items.slice(i, i + IMPORT_CHUNK))
          if (!Array.isArray(res?.categories)) throw new Error('respuesta inválida')
          last = res.categories
        }
        out.categories = last
        drop(storage, CUSTOM_CATS_KEY)
      }
    }
  } catch {
    out.failed.push('categories')
  }

  if (!prefs) return out

  async function upload(kind, data) {
    const res = await api.putPref(kind, data)
    if (!res || typeof res !== 'object') throw new Error('respuesta inválida')
    out.applied[kind] = data
  }

  // 2. Ajustes
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (raw != null) {
      if (prefs.settings != null) {
        drop(storage, SETTINGS_KEY) // el servidor gana
      } else {
        const s = readLegacySettings(storage)
        if (s === undefined) out.failed.push('settings')
        else { await upload('settings', s); drop(storage, SETTINGS_KEY) }
      }
    }
  } catch { out.failed.push('settings') }

  // 3. Presupuestos
  try {
    const items = readLegacyBudgets(storage)
    if (items === null) {
      out.failed.push('budgets')
    } else if (items !== undefined) {
      if (prefs.budgets != null || items.length === 0) {
        drop(storage, BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1)
      } else {
        await upload('budgets', { version: 3, items })
        drop(storage, BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1)
      }
    }
  } catch { out.failed.push('budgets') }

  // 4. Categorías ocultas (regla antigua por nombre, una sola vez)
  try {
    if (prefs.hidden_categories == null) {
      await upload('hidden_categories', legacyHiddenFor(user?.name))
    }
  } catch { out.failed.push('hidden_categories') }

  // 5. Tour visto
  try {
    const raw = storage.getItem(TOUR_KEY)
    if (raw != null) {
      if (prefs.tour != null) {
        drop(storage, TOUR_KEY)
      } else {
        await upload('tour', { seen_at: raw })
        drop(storage, TOUR_KEY)
      }
    }
  } catch { out.failed.push('tour') }

  return out
}
