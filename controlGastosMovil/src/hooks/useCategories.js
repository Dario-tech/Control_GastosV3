import { useMemo } from 'react'
import { DEFAULT_CATEGORIES, mergeCategories } from '../data/categories'
import { useSettings } from '../context/SettingsContext'

// Categorías por defecto sin las que el usuario tiene ocultas (preferencia
// `hidden_categories` del servidor). Las propias se suman aparte en cada pantalla.
export function useCategories() {
  const hidden = useSettings()?.hiddenCategories
  return useMemo(() => {
    if (!hidden || hidden.length === 0) return DEFAULT_CATEGORIES
    return mergeCategories({}, hidden)
  }, [hidden])
}
