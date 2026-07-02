import { useState, useCallback } from 'react'

const LS_KEY = 'mi-economia-budget-v1'

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
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
      const next = [...prev, { ...data, id: Date.now().toString() }]
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
