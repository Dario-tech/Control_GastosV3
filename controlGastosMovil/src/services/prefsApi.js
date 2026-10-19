import { BASE, authHeaders, apiJson, WRITE_TIMEOUT_MS } from './api'

// Preferencias del usuario guardadas en el servidor.
// kind ∈ settings | budgets | hidden_categories | tour (tope 64 KB cada una).

export async function fetchPrefs() {
  const res = await fetch(`${BASE}/api/prefs`, {
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function putPref(kind, data) {
  const res = await fetch(`${BASE}/api/prefs/${kind}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ data }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}
