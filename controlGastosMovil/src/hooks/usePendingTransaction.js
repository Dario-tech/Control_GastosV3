import { useState, useEffect } from 'react'

const LS_KEY = 'mi-economia-pending-tx'

export function usePendingTransaction() {
  const [pendingAmount, setPendingAmount] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY)
      return stored ? parseFloat(stored) : null
    } catch { return null }
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const amount = params.get('amount')
    if (amount) {
      const num = parseFloat(amount)
      if (!isNaN(num) && num > 0) {
        localStorage.setItem(LS_KEY, String(num))
        setPendingAmount(num)
        window.history.replaceState({}, '', window.location.pathname)
      }
    }
  }, [])

  function clearPending() {
    localStorage.removeItem(LS_KEY)
    setPendingAmount(null)
  }

  return { pendingAmount, clearPending }
}
