import { useState, useCallback } from 'react'

const LS_KEY = 'mi-economia-budget-v3'

export const BUDGET_COLORS = [
  '#6366f1', '#3b82f6', '#a855f7', '#22c55e',
  '#f59e0b', '#fb923c', '#f43f5e', '#06b6d4',
  '#ec4899', '#84cc16', '#14b8a6', '#8b5cf6',
]

function autoColor(index) {
  return BUDGET_COLORS[index % BUDGET_COLORS.length]
}

function load() {
  try {
    // v3: items con campo month
    const v3 = localStorage.getItem(LS_KEY)
    if (v3) return JSON.parse(v3)

    // Migrar v2 → v3: asignar mes actual a items existentes
    const v2 = localStorage.getItem('mi-economia-budget-v2')
    if (v2) {
      const currentMonth = new Date().getMonth()
      const items = JSON.parse(v2).map((item, i) => ({
        ...item,
        color: item.color || autoColor(i),
        month: currentMonth,
      }))
      localStorage.setItem(LS_KEY, JSON.stringify(items))
      return items
    }

    // Migrar v1 → v3
    const v1 = localStorage.getItem('mi-economia-budget-v1')
    if (v1) {
      const currentMonth = new Date().getMonth()
      const items = JSON.parse(v1).map((item, i) => ({
        ...item,
        color: autoColor(i),
        month: currentMonth,
      }))
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
  const [allItems, setAllItems] = useState(load)

  // Solo los items del mes seleccionado
  function itemsForMonth(month) {
    return allItems.filter(i => i.month === month)
  }

  const addItem = useCallback((data, month) => {
    setAllItems(prev => {
      const monthItems = prev.filter(i => i.month === month)
      const color = data.color || autoColor(monthItems.length)
      const next  = [...prev, { ...data, color, month, id: Date.now().toString() }]
      persist(next)
      return next
    })
  }, [])

  const updateItem = useCallback((id, data) => {
    setAllItems(prev => {
      const next = prev.map(i => i.id === id ? { ...i, ...data } : i)
      persist(next)
      return next
    })
  }, [])

  const removeItem = useCallback((id) => {
    setAllItems(prev => {
      const next = prev.filter(i => i.id !== id)
      persist(next)
      return next
    })
  }, [])

  return { allItems, itemsForMonth, addItem, updateItem, removeItem }
}
