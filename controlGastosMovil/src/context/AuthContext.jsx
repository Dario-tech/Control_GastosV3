import { createContext, useContext, useState, useEffect } from 'react'
import { SESSION_EXPIRED_EVENT } from '../services/api'
import { AUTH_KEY as LS_KEY, clearUserData } from '../utils/storageKeys'

const BASE   = import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com'

// Render (plan gratuito) puede dormir el backend tras inactividad y tardar
// 30-60s en despertar. Sin timeout, en móvil la petición se queda "esperando"
// para siempre sin que el usuario sepa qué está pasando.
const LOGIN_TIMEOUT_MS = 45000

function friendlyAuthError(e, fallback) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return new Error('El servidor está despertando, puede tardar unos segundos. Vuelve a intentarlo.')
  }
  return e instanceof Error ? e : new Error(fallback)
}

function loadStored() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) } catch { return null }
}

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadStored)
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState('')

  // Cualquier llamada a la API puede avisar de que el token ya no vale
  // (caducado, o el backend cambió de secreto) — en ese caso cerramos
  // sesión aquí mismo y dejamos un mensaje claro para la pantalla de login,
  // en vez de que cada sitio de la app muestre su propio error genérico.
  useEffect(() => {
    function handleExpired() {
      // Misma limpieza que logout(): no dejar datos financieros en el
      // dispositivo para quien inicie sesión después.
      clearUserData()
      setUser(null)
      setSessionExpiredMsg('Tu sesión ha caducado. Vuelve a iniciar sesión.')
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired)
  }, [])

  function authErrorMessage(res, body, fallback) {
    if (typeof body?.detail === 'string' && body.detail) return body.detail
    if (res.status === 429) return 'Demasiados intentos, espera unos minutos'
    return fallback
  }

  async function loginWithGoogle(googleToken) {
    let res
    try {
      res = await fetch(`${BASE}/api/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: googleToken }),
        signal:  AbortSignal.timeout(LOGIN_TIMEOUT_MS),
      })
    } catch (e) {
      throw friendlyAuthError(e, 'No se pudo conectar con el servidor')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(authErrorMessage(res, err, 'Login fallido'))
    }
    const data   = await res.json()
    const stored = { ...data.user, sessionToken: data.session_token }
    localStorage.setItem(LS_KEY, JSON.stringify(stored))
    setUser(stored)
    return stored
  }

  async function authWithEmail(path, payload) {
    let res
    try {
      res = await fetch(`${BASE}${path}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(LOGIN_TIMEOUT_MS),
      })
    } catch (e) {
      throw friendlyAuthError(e, 'No se pudo conectar con el servidor')
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(authErrorMessage(res, data, 'Error de autenticación'))
    }
    const stored = { ...data.user, sessionToken: data.session_token }
    localStorage.setItem(LS_KEY, JSON.stringify(stored))
    setUser(stored)
    return stored
  }

  function registerWithEmail(email, name, password) {
    return authWithEmail('/api/auth/register', { email, name, password })
  }

  function loginWithEmail(email, password) {
    return authWithEmail('/api/auth/login-email', { email, password })
  }

  // Borra la sesión y todas las cachés con datos del usuario (finanzas,
  // presupuestos, categorías propias, avisos ya enviados). Las preferencias de
  // interfaz (tema, acento...) se conservan.
  function logout() {
    clearUserData()
    setUser(null)
  }

  function clearSessionExpiredMsg() {
    setSessionExpiredMsg('')
  }

  return (
    <AuthCtx.Provider value={{
      user, loginWithGoogle, registerWithEmail, loginWithEmail, logout,
      sessionExpiredMsg, clearSessionExpiredMsg,
    }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  return useContext(AuthCtx)
}
