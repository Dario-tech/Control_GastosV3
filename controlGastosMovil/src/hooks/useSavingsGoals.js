import { useState, useEffect, useCallback } from 'react'
import {
  fetchGoals, createGoal, updateGoal, deleteGoal, contributeToGoal, shareGoal,
} from '../services/api'

// Antes vivían en localStorage; ahora en el backend, porque compartir una
// meta entre dos cuentas necesita una fuente de verdad común.
export function useSavingsGoals() {
  const [goals, setGoals]   = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error

  const refresh = useCallback(() => {
    setStatus(s => (s === 'ready' ? s : 'loading'))
    return fetchGoals()
      .then(data => { setGoals(Array.isArray(data) ? data : []); setStatus('ready') })
      .catch(() => setStatus('error'))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function addGoal(data) {
    await createGoal(data.nombre, data.objetivo, data.emoji, data.fecha || null, data.imagen_url || null)
    await refresh()
  }

  async function editGoal(id, data) {
    await updateGoal(id, data.nombre, data.objetivo, data.emoji, data.fecha || null, data.imagen_url || null)
    await refresh()
  }

  async function removeGoal(id) {
    await deleteGoal(id)
    await refresh()
  }

  async function addMoney(id, importe) {
    await contributeToGoal(id, importe)
    await refresh()
  }

  async function share(id, email) {
    await shareGoal(id, email)
    await refresh()
  }

  return { goals, status, refresh, addGoal, editGoal, removeGoal, addMoney, share }
}
