import { BASE, authHeaders, apiJson, WRITE_TIMEOUT_MS } from './api'

// Categorías propias del usuario (las de por defecto viven en el código).
// Cada item: { id, tipo, concepto, emoji }.

const JSON_HEADERS = () => ({ 'Content-Type': 'application/json', ...authHeaders() })

export async function fetchCategories() {
  const res = await fetch(`${BASE}/api/categories`, {
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// 409 si ya existe, 422 si no es válida (el error lleva .status).
export async function createCategory({ tipo, concepto, emoji }) {
  const body = { tipo, concepto }
  if (emoji) body.emoji = emoji
  const res = await fetch(`${BASE}/api/categories`, {
    method:  'POST',
    headers: JSON_HEADERS(),
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function updateCategory(id, changes) {
  const res = await fetch(`${BASE}/api/categories/${id}`, {
    method:  'PATCH',
    headers: JSON_HEADERS(),
    body:    JSON.stringify(changes),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// No afecta a las transacciones ya guardadas. 204 sin cuerpo.
export async function deleteCategory(id) {
  const res = await fetch(`${BASE}/api/categories/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// Importación única de las categorías antiguas del móvil (máx. 200 por
// llamada, idempotente). Devuelve { imported, skipped, categories }.
export async function importCategories(items) {
  const res = await fetch(`${BASE}/api/categories/import`, {
    method:  'POST',
    headers: JSON_HEADERS(),
    body:    JSON.stringify({ items }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}
