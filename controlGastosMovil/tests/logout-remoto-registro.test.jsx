// Cierre de sesión con revocación en el servidor y registro cerrado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, renderHook, act, cleanup } from '@testing-library/react'
import { AuthProvider, useAuth, REGISTRO_CERRADO } from '../src/context/AuthContext'
import { SettingsProvider } from '../src/context/SettingsContext'
import LoginScreen from '../src/components/auth/LoginScreen'
import { AUTH_KEY } from '../src/utils/storageKeys'
import { SESSION_EXPIRED_EVENT, apiJson, errorDetail } from '../src/services/api'

const wrapper = ({ children }) => <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
let calls
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(AUTH_KEY, JSON.stringify({ email: 'a@a.es', name: 'A', sessionToken: 'tok123' }))
  calls = []
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('logout', () => {
  it('llama a /api/auth/logout con el token y limpia todo', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push([String(url), opts]); return { status: 200, ok: true, json: async () => ({}) } }))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { await result.current.logout() })
    const c = calls.find(([u]) => u.endsWith('/api/auth/logout'))
    expect(c[1].method).toBe('POST')
    expect(c[1].headers.Authorization).toBe('Bearer tok123')
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem(AUTH_KEY)).toBeNull()
  })

  it('sin red o con error del servidor, el cierre local funciona igual', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { await result.current.logout() })
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem(AUTH_KEY)).toBeNull()
  })

  it('un 401 (sesión revocada o caducada) limpia la sesión y deja el mensaje de caducada', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {
      await apiJson({ status: 401, ok: false, json: async () => ({}) }).catch(() => {})
    })
    expect(result.current.user).toBeNull()
    expect(result.current.sessionExpiredMsg).toMatch(/caducado/)
    expect(localStorage.getItem(AUTH_KEY)).toBeNull()
    void SESSION_EXPIRED_EVENT
  })
})

describe('registro cerrado', () => {
  beforeEach(() => localStorage.clear())

  it('muestra el mensaje del 403 y atenúa «Regístrate»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 403, ok: false, json: async () => ({ detail: REGISTRO_CERRADO }) })))
    render(<LoginScreen />, { wrapper })
    fireEvent.click(screen.getByText(/Regístrate/))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'n@n.es' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'una-clave-larga-1' } })
    fireEvent.click(screen.getByText('Crear cuenta'))
    expect((await screen.findByRole('alert')).textContent).toBe(REGISTRO_CERRADO)
    expect(screen.queryByText(/Regístrate/)).toBeNull()
    expect(screen.getByText(/El registro está cerrado/, { selector: 'p.login-switch' })).toBeTruthy()
    expect(screen.getByText('Entrar')).toBeTruthy() // vuelve al formulario de acceso
  })

  it('un 422 de validación (lista) se muestra legible y no rompe la pantalla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 422, ok: false, json: async () => ({ detail: [{ msg: 'Email no válido', loc: ['body', 'email'] }] }) })))
    render(<LoginScreen />, { wrapper })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@y.es' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('Entrar'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Email no válido'))
  })

  it('errorDetail tolera cualquier forma de cuerpo', () => {
    expect(errorDetail({ detail: 'x' }, 'f')).toBe('x')
    expect(errorDetail({ detail: [{ msg: 'a' }, { msg: 'b' }] }, 'f')).toBe('a. b')
    expect(errorDetail({ detail: { raro: 1 } }, 'f')).toBe('f')
    expect(errorDetail(null, 'f')).toBe('f')
  })
})
