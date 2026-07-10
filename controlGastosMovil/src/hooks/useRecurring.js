import { useState, useEffect } from 'react'
import { fetchRecurring } from '../services/api'

export function useRecurring() {
  const [items, setItems]   = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error

  useEffect(() => {
    let alive = true
    fetchRecurring()
      .then(data => {
        if (!alive) return
        setItems(Array.isArray(data) ? data : [])
        setStatus('ready')
      })
      .catch(() => { if (alive) setStatus('error') })
    return () => { alive = false }
  }, [])

  return { items, status }
}
