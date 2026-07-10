import { useState, useCallback } from 'react'

// Se guarda en localStorage, igual que el presupuesto (device-local, sin backend).
const LS_KEY = 'mi-economia-goals-v1'

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persist(goals) {
  localStorage.setItem(LS_KEY, JSON.stringify(goals))
}

export function useSavingsGoals() {
  const [goals, setGoals] = useState(load)

  const addGoal = useCallback((data) => {
    setGoals(prev => {
      const next = [...prev, {
        id:       Date.now().toString(),
        nombre:   data.nombre,
        objetivo: data.objetivo,
        ahorrado: data.ahorrado || 0,
        fecha:    data.fecha || null,
        emoji:    data.emoji || '🎯',
      }]
      persist(next)
      return next
    })
  }, [])

  const updateGoal = useCallback((id, data) => {
    setGoals(prev => {
      const next = prev.map(g => g.id === id ? { ...g, ...data } : g)
      persist(next)
      return next
    })
  }, [])

  const removeGoal = useCallback((id) => {
    setGoals(prev => {
      const next = prev.filter(g => g.id !== id)
      persist(next)
      return next
    })
  }, [])

  return { goals, addGoal, updateGoal, removeGoal }
}
