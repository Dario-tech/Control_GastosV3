const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001'

export async function fetchPrices() {
  const res = await fetch(`${BASE}/api/investments/prices`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export async function fetchFinanceData() {
  const res = await fetch(`${BASE}/api/finance`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export async function deleteTransaction(rowIndex) {
  const res = await fetch(`${BASE}/api/transactions/${rowIndex}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Delete ${res.status}`)
  return res.json()
}
