import { useCallback } from 'react'
import { newId } from '../utils/id'
import { BUDGET_COLORS, autoColor } from '../utils/budget'
import { useSettings } from '../context/SettingsContext'

export { BUDGET_COLORS }

// Los presupuestos son una preferencia del servidor (por usuario); viven en
// SettingsContext con caché local para pintar rápido y escritura optimista.
export function useBudget() {
  const { budgetItems: allItems, updateBudgets } = useSettings()

  // Solo los items del mes seleccionado
  function itemsForMonth(month) {
    return allItems.filter(i => i.month === month)
  }

  const addItem = useCallback((data, month) => {
    const id = newId()
    updateBudgets(prev => {
      const monthItems = prev.filter(i => i.month === month)
      const color = data.color || autoColor(monthItems.length)
      return [...prev, { ...data, color, month, id }]
    })
  }, [updateBudgets])

  const updateItem = useCallback((id, data) => {
    updateBudgets(prev => prev.map(i => i.id === id ? { ...i, ...data } : i))
  }, [updateBudgets])

  const removeItem = useCallback((id) => {
    updateBudgets(prev => prev.filter(i => i.id !== id))
  }, [updateBudgets])

  return { allItems, itemsForMonth, addItem, updateItem, removeItem }
}
