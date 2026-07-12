import { createContext, useContext, useState } from 'react'

const BASE   = import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com'
const LS_KEY = 'mi-economia-auth-v1'

// Render (plan gratuito) puede dormir el backend tras inactividad y tardar
// 30-60s en despertar. Sin timeout, la petición se queda "esperando" para
// siempre sin que el usuario sepa qué está pasando.
const LOGIN_TIMEOUT_MS = 45000

function loadStored() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) } catch { return null }
}

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadStored)

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
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new Error('El servidor está despertando, puede tardar unos segundos. Vuelve a intentarlo.')
      }
      throw new Error('No se pudo conectar con el servidor')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Login fallido')
    }
    const data   = await res.json()
    const stored = { ...data.user, sessionToken: data.session_token }
    localStorage.setItem(LS_KEY, JSON.stringify(stored))
    setUser(stored)
    return stored
  }

  function logout() {
    localStorage.removeItem(LS_KEY)
    setUser(null)
  }

  return (
    <AuthCtx.Provider value={{ user, loginWithGoogle, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  return useContext(AuthCtx)
}
