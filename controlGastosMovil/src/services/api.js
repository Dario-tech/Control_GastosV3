const BASE   = import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com'
const LS_KEY = 'mi-economia-auth-v1'

function authHeaders() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY))
    if (stored?.sessionToken) {
      return { Authorization: `Bearer ${stored.sessionToken}` }
    }
  } catch { /* no-op */ }
  return {}
}

export async function fetchPrices() {
  const res = await fetch(`${BASE}/api/investments/prices`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export async function fetchFinanceData() {
  const res = await fetch(`${BASE}/api/finance`, {
    headers: authHeaders(),
    signal:  AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export async function postTransaction(importe, tipo, concepto, fecha = null) {
  const body = { importe, tipo, concepto, source: 'app' }
  if (fecha) body.fecha = fecha
  const res = await fetch(`${BASE}/api/transaction`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export async function deleteTransaction(rowIndex) {
  const res = await fetch(`${BASE}/api/transactions/${rowIndex}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Delete ${res.status}`)
  return res.json()
}
