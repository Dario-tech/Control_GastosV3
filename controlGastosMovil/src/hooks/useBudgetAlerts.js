import { useState, useEffect } from 'react'
import { useSettings } from '../context/SettingsContext'
import { fmt } from '../utils'
import { createNotifCache } from '../utils/notifCache'

const notifCache = createNotifCache('mi-economia-notif-v1')

// Permiso de notificaciones + aviso cuando una categoría de presupuesto cruza
// el umbral de alerta. `getRealSpent(nombre)` devuelve lo gastado en el mes.
export function useBudgetAlerts({ items, getRealSpent, month, data }) {
  const { settings } = useSettings()
  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  )

  async function requestNotifPermission() {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      requestNotifPermission()
    }
  }, [])

  useEffect(() => {
    if (!settings.budgetAlerts || notifPermission !== 'granted') return
    const cache = notifCache.get()
    let changed = false
    items.forEach(item => {
      const spent     = getRealSpent(item.name)
      const pct       = item.limit > 0 ? (spent / item.limit) * 100 : 0
      const cacheKey  = `${item.id}-${month}`
      const lastSpent = cache[cacheKey] ?? 0
      if (spent !== lastSpent) {
        cache[cacheKey] = spent
        changed = true
        const threshold = (settings.alertThreshold / 100) * item.limit
        if (spent >= threshold && lastSpent < threshold) {
          new Notification(`⚠️ Presupuesto: ${item.emoji} ${item.name}`, {
            body: `Has gastado el ${Math.round(pct)}% de tu límite (${fmt(spent)} de ${fmt(item.limit)})`,
            icon: '/icons/icon-192.png',
            tag: cacheKey,
          })
        }
      }
    })
    if (changed) notifCache.set(cache)
  }, [data, items, month, settings.budgetAlerts, settings.alertThreshold, notifPermission])

  return { notifPermission, requestNotifPermission }
}
