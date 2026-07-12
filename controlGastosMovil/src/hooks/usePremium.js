import { useState, useEffect, useCallback } from 'react'
import { fetchPremiumStatus } from '../services/api'

export function usePremium() {
  const [isPremium, setIsPremium] = useState(false)
  const [loading, setLoading]     = useState(true)

  const refresh = useCallback(() => {
    return fetchPremiumStatus()
      .then(d => setIsPremium(Boolean(d.is_premium)))
      .catch(() => setIsPremium(false))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { isPremium, loading, refresh }
}
