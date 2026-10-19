import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { SettingsProvider, useSettings } from '../src/context/SettingsContext'
import { SESSION_EXPIRED_EVENT } from '../src/services/api'
import {
  USER_DATA_KEYS, AUTH_KEY, FINANCE_CACHE_KEY, CATS_CACHE_KEY, PREFS_CACHE_KEY, BUDGET_KEY, BUDGET_KEY_V2, BUDGET_KEY_V1,
  CUSTOM_CATS_KEY, SETTINGS_KEY, TOUR_KEY, BUDGET_NOTIF_KEY, ANNUAL_NOTIF_KEY, SHORTCUT_QUEUE_KEY,
  LEGACY_KEYS, clearUserData,
} from '../src/utils/storageKeys'

// Claves antiguas con datos que quizá solo existan en este móvil
const LEGACY_SEED = {
  [BUDGET_KEY]:      JSON.stringify([{ id: 1, limit: 300, month: 0 }]),
  [BUDGET_KEY_V2]:   '[]',
  [BUDGET_KEY_V1]:   '[]',
  [CUSTOM_CATS_KEY]: JSON.stringify({ 'Gasto Variable': [{ concepto: 'Clínica' }] }),
  [SETTINGS_KEY]:    JSON.stringify({ theme: 'light', accent: '#10b981' }),
  [TOUR_KEY]:        '2026-01-01T00:00:00.000Z',
}

function seedStorage() {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ email: 'a@a.es', name: 'A', sessionToken: 't' }))
  localStorage.setItem(FINANCE_CACHE_KEY, JSON.stringify({ transactions: [{ importe: 1234 }] }))
  localStorage.setItem(CATS_CACHE_KEY, JSON.stringify({ email: 'a@a.es', categories: [{ id: '1', tipo: 'Gasto Variable', concepto: 'Clínica' }] }))
  localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify({ email: 'a@a.es', settings: { theme: 'light' } }))
  localStorage.setItem(BUDGET_NOTIF_KEY, JSON.stringify({ 'Super-2026-0': true }))
  localStorage.setItem(ANNUAL_NOTIF_KEY, JSON.stringify({ 'Seguro-2026': true }))
  localStorage.setItem(SHORTCUT_QUEUE_KEY, '[]')
  localStorage.setItem('mi-economia-cal-open', 'true')
  for (const [k, v] of Object.entries(LEGACY_SEED)) localStorage.setItem(k, v)
}

function expectUserDataGone() {
  for (const key of USER_DATA_KEYS) expect(localStorage.getItem(key), key).toBeNull()
}

// Lo pendiente de importar al servidor jamás se borra al cerrar sesión ni con un 401
function expectLegacyKept() {
  for (const [k, v] of Object.entries(LEGACY_SEED)) expect(localStorage.getItem(k), k).toBe(v)
  expect(localStorage.getItem('mi-economia-cal-open')).toBe('true')
}

const wrapper = ({ children }) => (
  <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
)

describe('limpieza de datos del usuario al cerrar sesión', () => {
  beforeEach(() => {
    localStorage.clear(); seedStorage()
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 404, ok: false, json: async () => ({}) })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('USER_DATA_KEYS son sesión y cachés; ninguna clave antigua pendiente de importar', () => {
    expect(USER_DATA_KEYS).toEqual(expect.arrayContaining([AUTH_KEY, FINANCE_CACHE_KEY, CATS_CACHE_KEY, PREFS_CACHE_KEY, BUDGET_NOTIF_KEY, ANNUAL_NOTIF_KEY]))
    for (const k of LEGACY_KEYS) expect(USER_DATA_KEYS).not.toContain(k)
  })

  it('clearUserData borra sesión y cachés, y deja las claves antiguas', () => {
    clearUserData()
    expectUserDataGone()
    expectLegacyKept()
  })

  it('logout() borra sesión y cachés, y deja las claves antiguas sin importar', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.user?.email).toBe('a@a.es')

    // Con datos antiguos pendientes intenta antes un último import (aquí falla: 404)
    await act(async () => { await result.current.logout() })

    expect(result.current.user).toBeNull()
    expectUserDataGone()
    expectLegacyKept()
  })

  it('la sesión caducada (401) borra SOLO sesión y caché de finanzas', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)) })

    expect(result.current.user).toBeNull()
    expect(result.current.sessionExpiredMsg).toMatch(/caducado/)
    expect(localStorage.getItem(AUTH_KEY)).toBeNull()
    expect(localStorage.getItem(FINANCE_CACHE_KEY)).toBeNull()
    expect(localStorage.getItem(CATS_CACHE_KEY)).not.toBeNull()
    expect(localStorage.getItem(PREFS_CACHE_KEY)).not.toBeNull()
    expect(localStorage.getItem(SHORTCUT_QUEUE_KEY)).not.toBeNull()
    expectLegacyKept()
  })

  it('las categorías propias en memoria se vacían al cerrar sesión', async () => {
    const { result } = renderHook(() => ({ auth: useAuth(), settings: useSettings() }), { wrapper })
    expect(result.current.settings.customCategories['Gasto Variable']).toHaveLength(1)

    await act(async () => { await result.current.auth.logout() })

    await waitFor(() => expect(result.current.settings.customCategories['Gasto Variable']).toEqual([]))
  })
})
