export const BASE = import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com'
const LS_KEY = 'mi-economia-auth-v1'

// Emitido cuando cualquier llamada a la API recibe un 401: el token guardado
// ya no vale (caducado, o el backend cambió de JWT_SECRET). AuthContext
// escucha esto para cerrar la sesión y avisar, en vez de dejar al usuario
// viendo un "Error al guardar" genérico sin saber que tiene que reentrar.
export const SESSION_EXPIRED_EVENT = 'session-expired'

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

// Único punto por el que pasan todas las respuestas autenticadas: si el
// backend dice 401, la sesión ya no vale — se limpia y se avisa al resto de
// la app en vez de dejar que cada llamada falle con un error genérico.
async function apiJson(res) {
  if (res.status === 401) {
    try { localStorage.removeItem(LS_KEY) } catch { /* no-op */ }
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail || `API ${res.status}`)
  return body
}

export async function fetchPrices() {
  const res = await fetch(`${BASE}/api/investments/prices`, { signal: AbortSignal.timeout(15000) })
  return apiJson(res)
}

export async function suggestEmoji(nombre) {
  const res = await fetch(`${BASE}/api/categorize/suggest-emoji`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ nombre }),
    signal:  AbortSignal.timeout(10000),
  })
  return apiJson(res)
}

export async function sendMonthlyReport() {
  const res = await fetch(`${BASE}/api/reports/monthly/send`, {
    method:  'POST',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(20000),
  })
  return apiJson(res)
}

export async function fetchRecurring() {
  const res = await fetch(`${BASE}/api/recurring`, {
    headers: authHeaders(),
    signal:  AbortSignal.timeout(15000),
  })
  return apiJson(res)
}

export async function fetchFinanceData() {
  const res = await fetch(`${BASE}/api/finance`, {
    headers: authHeaders(),
    signal:  AbortSignal.timeout(15000),
  })
  return apiJson(res)
}

export async function postTransaction(importe, tipo, concepto, fecha = null, comentario = null) {
  const body = { importe, tipo, concepto, source: 'app' }
  if (fecha) body.fecha = fecha
  if (comentario) body.comentario = comentario
  const res = await fetch(`${BASE}/api/transaction`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function deleteTransaction(rowIndex) {
  const res = await fetch(`${BASE}/api/transactions/${rowIndex}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function updateTransactionComment(rowIndex, comentario) {
  const res = await fetch(`${BASE}/api/transactions/${rowIndex}/comment`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ comentario }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// ── Metas de ahorro (compartibles entre usuarios) ──────────────────────────

export async function fetchGoals() {
  const res = await fetch(`${BASE}/api/goals`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) })
  return apiJson(res)
}

export async function createGoal(nombre, objetivo, emoji, fecha, imagen_url) {
  const res = await fetch(`${BASE}/api/goals`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ nombre, objetivo, emoji, fecha, imagen_url }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function updateGoal(id, nombre, objetivo, emoji, fecha, imagen_url) {
  const res = await fetch(`${BASE}/api/goals/${id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ nombre, objetivo, emoji, fecha, imagen_url }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function deleteGoal(id) {
  const res = await fetch(`${BASE}/api/goals/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function contributeToGoal(id, importe, foto = null) {
  const res = await fetch(`${BASE}/api/goals/${id}/contribute`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ importe, foto }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function deleteContribution(goalId, contributionId) {
  const res = await fetch(`${BASE}/api/goals/${goalId}/contributions/${contributionId}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function shareGoal(id, email) {
  const res = await fetch(`${BASE}/api/goals/${id}/share`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ email }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// ── Gastos fijos anuales ────────────────────────────────────────────────────

export async function fetchAnnualExpenses() {
  const res = await fetch(`${BASE}/api/annual-expenses`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) })
  return apiJson(res)
}

export async function createAnnualExpense(payload) {
  const res = await fetch(`${BASE}/api/annual-expenses`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function updateAnnualExpense(id, payload) {
  const res = await fetch(`${BASE}/api/annual-expenses/${id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function deleteAnnualExpense(id) {
  const res = await fetch(`${BASE}/api/annual-expenses/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}
