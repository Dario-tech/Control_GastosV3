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
// 30-60s en despertar. 15s era insuficiente para la carga inicial de datos
// (el keep-alive no siempre evita que se duerma) y provocaba que el perfil
// mostrara "Backend no disponible" con el backend en realidad sano.
const READ_TIMEOUT_MS = 45000

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
    signal:  AbortSignal.timeout(READ_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

// Render (plan gratuito) puede dormir el backend tras inactividad y tardar
// 30-60s en despertar. 45s da margen sin que la app se quede colgada para
// siempre si el backend está realmente caído.
const WRITE_TIMEOUT_MS = 45000

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
