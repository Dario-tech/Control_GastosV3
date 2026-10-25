import { useMemo } from 'react'
import { DEFAULT_CATEGORIES, mergeCategories } from '../data/categories'
import { useSettings } from '../context/SettingsContext'

// Categorías por defecto sin las que el usuario tiene ocultas (preferencia
// `hidden_categories` del servidor). Las propias se suman aparte en cada pantalla.
// Ocultar solo afecta a ELEGIR categoría en movimientos nuevos y pendientes; las
// pantallas que muestran o editan datos ya guardados (presupuestos, edición de
// un movimiento) piden `{ includeHidden: true }` para ver todas.
export function useCategories({ includeHidden = false } = {}) {
  const hidden = useSettings()?.hiddenCategories
  return useMemo(() => {
    if (includeHidden || !hidden || hidden.length === 0) return DEFAULT_CATEGORIES
    return mergeCategories({}, hidden)
  }, [hidden, includeHidden])
}
