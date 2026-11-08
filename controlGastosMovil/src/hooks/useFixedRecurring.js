import { useState, useEffect, useCallback } from 'react'
import { fetchFixedRecurring, createFixedRecurring, updateFixedRecurring, deleteFixedRecurring } from '../services/api'

export function useFixedRecurring() {
  const [rules, setRules]   = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error

  const refresh = useCallback(() => fetchFixedRecurring()
    .then(d => { setRules(Array.isArray(d) ? d : []); setStatus('ready') })
    .catch(() => setStatus(s => (s === 'ready' ? s : 'error'))), [])

  useEffect(() => {
    refresh()
    // Una regla creada o cambiada desde otra pantalla (p. ej. al apuntar un gasto) refresca esta lista.
    window.addEventListener('fixed-recurring-changed', refresh)
    return () => window.removeEventListener('fixed-recurring-changed', refresh)
  }, [refresh])

  const changed = () => window.dispatchEvent(new Event('fixed-recurring-changed'))
  return {
    rules, status, refresh,
    addRule:    async rule => { await createFixedRecurring(rule); changed() },
    editRule:   async (id, rule) => { await updateFixedRecurring(id, rule); changed() },
    removeRule: async id => { await deleteFixedRecurring(id); changed() },
  }
}
