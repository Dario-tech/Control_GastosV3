let _seq = 0

// Id único para items locales. Usa crypto.randomUUID si existe; si no, combina
// tiempo + contador monotónico + aleatorio (único incluso en el mismo ms).
// Los ids antiguos (Date.now().toString()) siguen siendo strings válidos.
export function newId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* contexto no seguro: usar fallback */ }
  _seq = (_seq + 1) % 1e9
  return `${Date.now().toString(36)}-${_seq.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
