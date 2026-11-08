import { useCallback } from 'react'
import { useSettings } from '../context/SettingsContext'

const MAX_MARKS = 100

/* Categorías que el usuario ha marcado como «suscripción». Se guardan en sus
   ajustes del servidor (settings.subscriptions: nombres normalizados), sin tablas nuevas. */
export function useSubscriptionMarks() {
  const { settings, update } = useSettings() ?? {}   // sin proveedor (tests aislados): sin marcas
  const keys = Array.isArray(settings?.subscriptions) ? settings.subscriptions : []
  const toggle = useCallback(key => {
    const cur = Array.isArray(settings?.subscriptions) ? settings.subscriptions : []
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key].slice(-MAX_MARKS)
    update?.('subscriptions', next)
  }, [settings, update])
  return { keys, toggle }
}
