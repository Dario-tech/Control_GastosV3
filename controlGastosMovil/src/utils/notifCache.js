// Caché en localStorage de las notificaciones ya enviadas (una por clave y día/mes),
// para no repetir el mismo aviso en cada render o recarga.
export function createNotifCache(storageKey) {
  return {
    get() {
      try { return JSON.parse(localStorage.getItem(storageKey) || '{}') }
      catch { return {} }
    },
    set(cache) {
      localStorage.setItem(storageKey, JSON.stringify(cache))
    },
  }
}
