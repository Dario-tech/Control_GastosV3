import { useState, useEffect, useCallback } from 'react'
import {
  fetchAnnualExpenses, createAnnualExpense, updateAnnualExpense, deleteAnnualExpense,
} from '../services/api'

export function useAnnualExpenses() {
  const [expenses, setExpenses] = useState([])
  const [status, setStatus]     = useState('loading') // loading | ready | error

  const refresh = useCallback(() => {
    setStatus(s => (s === 'ready' ? s : 'loading'))
    return fetchAnnualExpenses()
      .then(data => { setExpenses(Array.isArray(data) ? data : []); setStatus('ready') })
      .catch(() => setStatus('error'))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function addExpense(data) {
    await createAnnualExpense(data)
    await refresh()
  }

  async function editExpense(id, data) {
    await updateAnnualExpense(id, data)
    await refresh()
  }

  async function removeExpense(id) {
    await deleteAnnualExpense(id)
    await refresh()
  }

  return { expenses, status, refresh, addExpense, editExpense, removeExpense }
}
