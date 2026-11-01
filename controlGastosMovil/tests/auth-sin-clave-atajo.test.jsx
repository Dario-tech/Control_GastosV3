// El shortcut_token nunca se guarda en el navegador: ni al iniciar sesión ni de sesiones antiguas.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { AUTH_KEY } from '../src/utils/storageKeys'

const KEY = 'CLAVE-INVENTADA-123'
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('shortcut_token fuera del navegador', () => {
  it('al iniciar sesión guarda la sesión sin la clave aunque el backend la envíe', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      user: { email: 'a@a.es', name: 'Ana', shortcut_token: KEY }, session_token: 'jwt',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { await result.current.loginWithEmail('a@a.es', 'x') })
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY))
    expect(saved).toEqual({ email: 'a@a.es', name: 'Ana', sessionToken: 'jwt' })
    expect(localStorage.getItem(AUTH_KEY)).not.toContain(KEY)
    expect(result.current.user.shortcut_token).toBeUndefined()
  })

  it('al leer una sesión antigua que la traía, la elimina y reescribe el objeto limpio', () => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ email: 'a@a.es', name: 'Ana', sessionToken: 'jwt', shortcut_token: KEY }))
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.user).toEqual({ email: 'a@a.es', name: 'Ana', sessionToken: 'jwt' })
    expect(JSON.parse(localStorage.getItem(AUTH_KEY))).toEqual({ email: 'a@a.es', name: 'Ana', sessionToken: 'jwt' })
    expect(localStorage.getItem(AUTH_KEY)).not.toContain(KEY)
  })
})
