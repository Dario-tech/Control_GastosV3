import { useMemo } from 'react'
import { DEFAULT_CATEGORIES, HIDDEN_CATEGORIES_BY_USER } from '../data/categories'
import { useAuth } from '../context/AuthContext'

export function useCategories() {
  const { user } = useAuth()
  return useMemo(() => {
    const rules = HIDDEN_CATEGORIES_BY_USER.filter(r => r.match(user?.name))
    if (rules.length === 0) return DEFAULT_CATEGORIES
    const hidden = new Set(rules.flatMap(r => r.hide))
    const result = {}
    for (const [tipo, cats] of Object.entries(DEFAULT_CATEGORIES)) {
      result[tipo] = cats.filter(c => !hidden.has(c.concepto))
    }
    return result
  }, [user?.name])
}
