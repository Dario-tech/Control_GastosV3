export const BASE = import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com'
const LS_KEY = 'mi-economia-auth-v1'

// Render (plan gratuito) duerme el backend tras inactividad. Llamar a esto en
// cuanto arranca la app "despierta" el servidor en segundo plano, para que
// cuando el usuario llegue a guardar algo el backend ya no esté frío.
// Fire-and-forget: nunca lanza, no bloquea nada.
export function wakeBackend() {
  fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(60000) }).catch(() => {})
}

// Render (plan gratuito) puede dormir el backend tras inactividad y tardar
// 30-60s en despertar. 45s da margen sin que la app se quede colgada para
// siempre si el backend está realmente caído.
const WRITE_TIMEOUT_MS = 45000

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

export async function suggestEmoji(nombre) {
  const res = await fetch(`${BASE}/api/categorize/suggest-emoji`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ nombre }),
    signal:  AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export async function sendMonthlyReport() {
  const res = await fetch(`${BASE}/api/reports/monthly/send`, {
    method:  'POST',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(20000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail || `API ${res.status}`)
  return body
}

export async function fetchRecurring() {
  const res = await fetch(`${BASE}/api/recurring`, {
    headers: authHeaders(),
    signal:  AbortSignal.timeout(15000),
  })
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
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export async function deleteTransaction(rowIndex) {
  const res = await fetch(`${BASE}/api/transactions/${rowIndex}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Delete ${res.status}`)
  return res.json()
}

// ── Metas de ahorro (compartibles entre usuarios) ──────────────────────────

async function goalsJson(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail || `API ${res.status}`)
  return body
}

export async function fetchGoals() {
  const res = await fetch(`${BASE}/api/goals`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) })
  return goalsJson(res)
}

export async function createGoal(nombre, objetivo, emoji, fecha, imagen_url) {
  const res = await fetch(`${BASE}/api/goals`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ nombre, objetivo, emoji, fecha, imagen_url }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return goalsJson(res)
}

export async function updateGoal(id, nombre, objetivo, emoji, fecha, imagen_url) {
  const res = await fetch(`${BASE}/api/goals/${id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ nombre, objetivo, emoji, fecha, imagen_url }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return goalsJson(res)
}

export async function deleteGoal(id) {
  const res = await fetch(`${BASE}/api/goals/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return goalsJson(res)
}

export async function contributeToGoal(id, importe) {
  const res = await fetch(`${BASE}/api/goals/${id}/contribute`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ importe }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return goalsJson(res)
}

export async function shareGoal(id, email) {
  const res = await fetch(`${BASE}/api/goals/${id}/share`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ email }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return goalsJson(res)
}
