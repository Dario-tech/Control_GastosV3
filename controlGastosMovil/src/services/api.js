import { AUTH_KEY as LS_KEY } from '../utils/storageKeys'

export const BASE = import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com'

// Emitido cuando cualquier llamada a la API recibe un 401: el token guardado
// ya no vale (caducado, o el backend cambió de JWT_SECRET). AuthContext
// escucha esto para cerrar la sesión y avisar, en vez de dejar al usuario
// viendo un "Error al guardar" genérico sin saber que tiene que reentrar.
export const SESSION_EXPIRED_EVENT = 'session-expired'

// Nombre del campo con el id de cliente (idempotencia) que se envía en el POST
// de un movimiento. Si el backend usa otro nombre, se cambia SOLO aquí.
export const CLIENT_ID_FIELD = 'id_cliente'

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
export const WRITE_TIMEOUT_MS = 45000

export function authHeaders() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY))
    if (stored?.sessionToken) {
      return { Authorization: `Bearer ${stored.sessionToken}` }
    }
  } catch { /* no-op */ }
  return {}
}

// Mensaje legible de un cuerpo de error: `detail` puede ser texto o, en los
// 422 de validación, una lista de {msg, loc}. Nunca lanza.
export function errorDetail(body, fallback) {
  const d = body?.detail
  if (typeof d === 'string' && d) return d
  if (Array.isArray(d)) {
    const msgs = d.map(x => (typeof x?.msg === 'string' ? x.msg : '')).filter(Boolean)
    if (msgs.length) return msgs.join('. ')
  }
  return fallback
}

// Cierra la sesión en el servidor (revoca el JWT actual). Mejor esfuerzo: timeout
// corto, nunca lanza ni bloquea. `token` se pasa explícito porque el llamador
// borra la sesión local justo después.
export function logoutRemote(token) {
  if (!token) return Promise.resolve()
  return fetch(`${BASE}/api/auth/logout`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(4000),
    keepalive: true,
  }).then(() => undefined, () => undefined)
}

// Único punto por el que pasan todas las respuestas autenticadas: si el
// backend dice 401, la sesión ya no vale — se limpia y se avisa al resto de
// la app en vez de dejar que cada llamada falle con un error genérico.
export async function apiJson(res) {
  if (res.status === 401) {
    try { localStorage.removeItem(LS_KEY) } catch { /* no-op */ }
    clearPhotoCache()
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    const err = new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.')
    err.status = 401
    throw err
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(errorDetail(body, `API ${res.status}`))
    err.status = res.status
    throw err
  }
  return body
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

// `signal` (opcional) permite cancelar la petición desde fuera; el timeout se mantiene.
export async function fetchFinanceData({ signal } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), WRITE_TIMEOUT_MS)
  if (signal) {
    if (signal.aborted) ctl.abort()
    else signal.addEventListener('abort', () => ctl.abort(), { once: true })
  }
  try {
    const res = await fetch(`${BASE}/api/finance`, { headers: authHeaders(), signal: ctl.signal })
    return await apiJson(res)
  } finally {
    clearTimeout(timer)
  }
}

// Movimientos de un solo año (más ligero que pedirlo todo de golpe).
export async function fetchFinanceYear(year) {
  const res = await fetch(`${BASE}/api/finance?year=${encodeURIComponent(year)}`, {
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// `idCliente` (UUID generado al abrir el formulario) permite al backend
// reconocer un reenvío del mismo movimiento y no duplicarlo.
export async function postTransaction(importe, tipo, concepto, fecha = null, comentario = null, idCliente = null) {
  const body = { importe, tipo, concepto, source: 'app' }
  if (idCliente) body[CLIENT_ID_FIELD] = idCliente
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

// El servidor gratuito puede estar durmiendo: se da el mismo margen que a las escrituras.
export async function searchTransactions({ q = '', tipo = 'all', cursor = null, limit = 30 } = {}) {
  const params = new URLSearchParams({ q, tipo, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  const res = await fetch(`${BASE}/api/transactions/search?${params}`, {
    headers: authHeaders(),
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

// Edición parcial de un movimiento: `changes` lleva solo los campos que
// cambian (fecha "YYYY-MM-DD", importe positivo, tipo, concepto, comentario;
// comentario "" lo borra). El signo lo decide `tipo`, igual que al crear.
export async function updateTransaction(rowIndex, changes) {
  const res = await fetch(`${BASE}/api/transactions/${rowIndex}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify(changes),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// ── Metas de ahorro (compartibles entre usuarios) ──────────────────────────

// Petición en vuelo compartida: dos pantallas que piden las metas a la vez
// (p. ej. Planificación) hacen una sola llamada. Toda escritura de metas la
// invalida para que una lectura posterior nunca reciba datos anteriores.
let goalsInflight = null
export function fetchGoals() {
  if (goalsInflight) return goalsInflight
  const p = (async () => {
    const res = await fetch(`${BASE}/api/goals`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) })
    return apiJson(res)
  })()
  goalsInflight = p
  const clear = () => { if (goalsInflight === p) goalsInflight = null }
  p.then(clear, clear)
  return p
}
const invalidateGoals = () => { goalsInflight = null }

export async function createGoal(nombre, objetivo, emoji, fecha, imagen_url) {
  invalidateGoals()
  const res = await fetch(`${BASE}/api/goals`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ nombre, objetivo, emoji, fecha, imagen_url }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function updateGoal(id, nombre, objetivo, emoji, fecha, imagen_url) {
  invalidateGoals()
  const res = await fetch(`${BASE}/api/goals/${id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ nombre, objetivo, emoji, fecha, imagen_url }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function deleteGoal(id) {
  invalidateGoals()
  const res = await fetch(`${BASE}/api/goals/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function contributeToGoal(id, importe, foto = null) {
  invalidateGoals()
  const res = await fetch(`${BASE}/api/goals/${id}/contribute`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ importe, foto }),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// Las fotos de las aportaciones ya no viajan en GET /api/goals (solo `tiene_foto`):
// se piden una a una al abrirlas. Caché SOLO en memoria (por id de aportación);
// nunca en localStorage. Se vacía al cerrar sesión.
const photoCache = new Map()     // contributionId -> data URL
const photoInflight = new Map()  // contributionId -> Promise

export function clearPhotoCache() { photoCache.clear(); photoInflight.clear() }
export function getCachedPhoto(contributionId) { return photoCache.get(contributionId) ?? null }

export function fetchContributionPhoto(goalId, contributionId) {
  if (photoCache.has(contributionId)) return Promise.resolve(photoCache.get(contributionId))
  if (photoInflight.has(contributionId)) return photoInflight.get(contributionId)
  const p = (async () => {
    const res = await fetch(`${BASE}/api/goals/${goalId}/contributions/${contributionId}/foto`, {
      headers: authHeaders(),
      signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
    })
    const body = await apiJson(res)
    if (typeof body?.foto !== 'string' || !body.foto) throw new Error('No se pudo cargar la foto.')
    photoCache.set(contributionId, body.foto)
    return body.foto
  })().finally(() => photoInflight.delete(contributionId))
  photoInflight.set(contributionId, p)
  return p
}

export async function deleteContribution(goalId, contributionId) {
  invalidateGoals()
  photoCache.delete(contributionId)
  const res = await fetch(`${BASE}/api/goals/${goalId}/contributions/${contributionId}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

export async function shareGoal(id, email) {
  invalidateGoals()
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

// ── Pagos pendientes (Apple Pay vía Atajo de iOS) ───────────────────────────

export async function fetchPending() {
  const res = await fetch(`${BASE}/api/pending`, {
    headers: authHeaders(),
    signal:  AbortSignal.timeout(15000),
  })
  return apiJson(res)
}

// Crea un pendiente con lo que manda el Atajo de iOS al abrir la app
// (?atajo=1&importe=…&comercio=…). `id_externo` permite al backend reconocer
// un reenvío del mismo pago y responder estado "duplicada" en vez de crearlo
// otra vez. Respuesta: { estado, id, importe, comercio, fecha, sugerencia }.
export async function createPending({ importe, comercio, fecha, fuente = 'wallet', id_externo }) {
  const body = { importe, fuente }
  if (comercio)   body.comercio = comercio
  if (fecha)      body.fecha = fecha
  if (id_externo) body.id_externo = id_externo
  const res = await fetch(`${BASE}/api/pending`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// `recordar` (por defecto true) hace que el backend aprenda comercio → categoría
// para sugerirla la próxima vez que se pague en el mismo sitio.
export async function categorizePending(id, { tipo, concepto, recordar = true, comentario } = {}) {
  const body = { tipo, concepto, recordar }
  if (comentario) body.comentario = comentario
  const res = await fetch(`${BASE}/api/pending/${id}/categorize`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// Descarta un pendiente sin apuntarlo (pago rechazado, duplicado, prueba...).
export async function discardPending(id) {
  const res = await fetch(`${BASE}/api/pending/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}

// Clave personal del Atajo (modo "En segundo plano"): el Atajo la manda en el
// cuerpo de POST /api/shortcut/pending en vez de un JWT. Respuesta: { shortcut_token }.
// Se pide al servidor solo al copiarla (no viene en el login ni se guarda en el
// navegador). Quien la llame no debe guardarla en localStorage ni en estado duradero.
export async function getShortcutToken() {
  const res = await fetch(`${BASE}/api/shortcut/token`, {
    headers: authHeaders(),
    signal:  AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  return apiJson(res)
}
