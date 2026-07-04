import { useState, useCallback } from 'react'

const LS_KEY = 'mi-economia-budget-v2'

// Paleta de colores para las categorías
export const BUDGET_COLORS = [
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#a855f7', // purple
  '#22c55e', // green
  '#f59e0b', // amber
  '#fb923c', // orange
  '#f43f5e', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#14b8a6', // teal
  '#8b5cf6', // violet
]

function autoColor(index) {
  return BUDGET_COLORS[index % BUDGET_COLORS.length]
}

function load() {
  try {
    // Migrar datos v1 si existen
    const v1 = localStorage.getItem('mi-economia-budget-v1')
    const v2 = localStorage.getItem(LS_KEY)
    if (v2) return JSON.parse(v2)
    if (v1) {
      const items = JSON.parse(v1).map((item, i) => ({ ...item, color: autoColor(i) }))
      localStorage.setItem(LS_KEY, JSON.stringify(items))
      return items
    }
    return []
  } catch {
    return []
  }
}

function persist(items) {
  localStorage.setItem(LS_KEY, JSON.stringify(items))
}

export function useBudget() {
  const [items, setItems] = useState(load)

  const addItem = useCallback((data) => {
    setItems(prev => {
      const color = data.color || autoColor(prev.length)
      const next  = [...prev, { ...data, color, id: Date.now().toString() }]
      persist(next)
      return next
    })
  }, [])

  const updateItem = useCallback((id, data) => {
    setItems(prev => {
      const next = prev.map(i => i.id === id ? { ...i, ...data } : i)
      persist(next)
      return next
    })
  }, [])

  const removeItem = useCallback((id) => {
    setItems(prev => {
      const next = prev.filter(i => i.id !== id)
      persist(next)
      return next
    })
  }, [])

  return { items, addItem, updateItem, removeItem }
}
