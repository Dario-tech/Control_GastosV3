import { createContext, useContext, useState } from 'react'

const BASE   = import.meta.env.VITE_API_URL || 'https://control-gastos-api-jflv.onrender.com'
const LS_KEY = 'mi-economia-auth-v1'

function loadStored() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) } catch { return null }
}

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadStored)

  async function loginWithGoogle(googleToken) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: googleToken }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Login fallido')
    }
    const data   = await res.json()
    const stored = { ...data.user, sessionToken: data.session_token, needsSetup: data.needs_setup }
    localStorage.setItem(LS_KEY, JSON.stringify(stored))
    setUser(stored)
    return stored
  }

  async function registerSheet(sheetUrl) {
    const stored = loadStored()
    const res = await fetch(`${BASE}/api/auth/register`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${stored?.sessionToken}`,
      },
      body: JSON.stringify({ sheet_url: sheetUrl }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Error al guardar configuración')
    }
    const updated = { ...stored, needsSetup: false }
    localStorage.setItem(LS_KEY, JSON.stringify(updated))
    setUser(updated)
  }

  function logout() {
    localStorage.removeItem(LS_KEY)
    setUser(null)
  }

  return (
    <AuthCtx.Provider value={{ user, loginWithGoogle, registerSheet, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  return useContext(AuthCtx)
}
