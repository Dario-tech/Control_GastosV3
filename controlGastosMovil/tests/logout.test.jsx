import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { SettingsProvider, useSettings } from '../src/context/SettingsContext'
import { SESSION_EXPIRED_EVENT } from '../src/services/api'
import {
  USER_DATA_KEYS, AUTH_KEY, FINANCE_CACHE_KEY, BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1,
  CUSTOM_CATS_KEY, BUDGET_NOTIF_KEY, ANNUAL_NOTIF_KEY, clearUserData,
} from '../src/utils/storageKeys'
import { TOUR_LS_KEY } from '../src/utils/tour'

const PREF_KEYS = {
  'mi-economia-settings-v1': JSON.stringify({ theme: 'light', accent: '#10b981' }),
  [TOUR_LS_KEY]:             '2026-01-01T00:00:00.000Z',
  'mi-economia-cal-open':    'true',
}

function seedStorage() {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ email: 'a@a.es', name: 'A', sessionToken: 't' }))
  localStorage.setItem(FINANCE_CACHE_KEY, JSON.stringify({ transactions: [{ importe: 1234 }] }))
  localStorage.setItem(BUDGET_KEY, JSON.stringify([{ id: 1, limit: 300, month: 0 }]))
  localStorage.setItem(BUDGET_KEY_V2, '[]')
  localStorage.setItem(BUDGET_KEY_V1, '[]')
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify({ 'Gasto Variable': [{ concepto: 'Clínica' }] }))
  localStorage.setItem(BUDGET_NOTIF_KEY, JSON.stringify({ 'Super-2026-0': true }))
  localStorage.setItem(ANNUAL_NOTIF_KEY, JSON.stringify({ 'Seguro-2026': true }))
  for (const [k, v] of Object.entries(PREF_KEYS)) localStorage.setItem(k, v)
}

function expectUserDataGone() {
  for (const key of USER_DATA_KEYS) expect(localStorage.getItem(key), key).toBeNull()
}

function expectPrefsKept() {
  for (const [k, v] of Object.entries(PREF_KEYS)) expect(localStorage.getItem(k), k).toBe(v)
}

const wrapper = ({ children }) => (
  <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
)

describe('limpieza de datos del usuario al cerrar sesión', () => {
  beforeEach(() => { localStorage.clear(); seedStorage() })

  it('USER_DATA_KEYS incluye sesión, caché de finanzas, presupuestos, categorías y avisos', () => {
    expect(USER_DATA_KEYS).toEqual(expect.arrayContaining([
      'mi-economia-auth-v1', 'mi-economia-finance-cache-v1', 'mi-economia-budget-v3',
      'mi-economia-custom-cats-v1', 'mi-economia-notif-v1', 'mi-economia-annual-notif-v1',
    ]))
    expect(USER_DATA_KEYS).not.toContain('mi-economia-settings-v1')
    expect(USER_DATA_KEYS).not.toContain(TOUR_LS_KEY)
  })

  it('clearUserData borra solo las claves con datos del usuario', () => {
    clearUserData()
    expectUserDataGone()
    expectPrefsKept()
  })

  it('logout() borra todas las cachés del usuario y conserva las preferencias de interfaz', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.user?.email).toBe('a@a.es')

    act(() => result.current.logout())

    expect(result.current.user).toBeNull()
    expectUserDataGone()
    expectPrefsKept()
  })

  it('la sesión caducada (401) también borra los datos del usuario', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)) })

    expect(result.current.user).toBeNull()
    expect(result.current.sessionExpiredMsg).toMatch(/caducado/)
    expectUserDataGone()
    expectPrefsKept()
  })

  it('las categorías propias en memoria se vacían al cerrar sesión', () => {
    const { result } = renderHook(() => ({ auth: useAuth(), settings: useSettings() }), { wrapper })
    expect(result.current.settings.customCategories['Gasto Variable']).toHaveLength(1)

    act(() => result.current.auth.logout())

    expect(result.current.settings.customCategories['Gasto Variable']).toEqual([])
    expect(result.current.settings.settings.theme).toBe('light')
  })
})
