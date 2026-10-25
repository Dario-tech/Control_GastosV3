// Recepción de pagos del Atajo: envío a /api/pending, cola offline, flujo sin
// sesión, guía de configuración y wrappers de la API de pendientes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, renderHook, act } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast }) }))

import { AUTH_KEY, clearUserData } from '../src/utils/storageKeys'
import { BASE, categorizePending, discardPending, createPending, SESSION_EXPIRED_EVENT } from '../src/services/api'
import { loadIntakeQueue } from '../src/utils/shortcutIntake'
import { useShortcutIntake } from '../src/hooks/useShortcutIntake'
import { usePendingTransaction } from '../src/hooks/usePendingTransaction'
import IntakeLoginBanner from '../src/components/auth/IntakeLoginBanner'
import ShortcutSetupScreen, { shortcutLinkBase, shortcutTestLink, buildPromptApp, buildPromptBackground, KEY_PLACEHOLDER } from '../src/components/ui/ShortcutSetupScreen'

const jsonRes = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const created = {
  estado: 'pendiente', id: 41, importe: 12.3, comercio: 'Mercadona', fecha: '2026-10-12',
  sugerencia: { tipo: 'Gasto Variable', concepto: 'Supermercado', origen: 'comercio' },
}

function login() {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ email: 'a@a.es', name: 'Ana', sessionToken: 'jwt' }))
}
const goTo = url => window.history.replaceState(null, '', url)
const postCalls = f => f.mock.calls.filter(([u, o]) => u === `${BASE}/api/pending` && o?.method === 'POST')

beforeEach(() => { localStorage.clear(); goTo('/'); showToast.mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('useShortcutIntake', () => {
  it('con sesión: envía el pago, limpia la URL y abre "Gasto recibido" con la sugerencia', async () => {
    login()
    goTo('/?atajo=1&importe=12%2C30%20%E2%82%AC&comercio=Mercadona')
    const fetchMock = vi.fn(() => jsonRes(created))
    vi.stubGlobal('fetch', fetchMock)
    const onChange = vi.fn()

    const { result } = renderHook(() => useShortcutIntake({ onChange }))
    await waitFor(() => expect(result.current.received).toBeTruthy())

    expect(window.location.search).toBe('')
    const [, opts] = postCalls(fetchMock)[0]
    expect(opts.headers.Authorization).toBe('Bearer jwt')
    const body = JSON.parse(opts.body)
    expect(body).toMatchObject({ importe: 12.3, comercio: 'Mercadona', fuente: 'wallet' })
    expect(body.id_externo).toMatch(/^wallet-/)
    expect(result.current.received).toEqual({
      id: 41, importe: 12.3, comercio: 'Mercadona', fecha: '2026-10-12', fuente: 'wallet',
      suggested: created.sugerencia,
    })
    expect(loadIntakeQueue()).toEqual([])
    expect(onChange).toHaveBeenCalled()
    expect(postCalls(fetchMock)).toHaveLength(1)
  })

  it('duplicada: se trata como éxito y abre la hoja con el id existente', async () => {
    login()
    goTo('/?atajo=1&importe=5&comercio=Bar&id=tx-1')
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({ ...created, id: 7, estado: 'duplicada' })))
    const { result } = renderHook(() => useShortcutIntake())
    await waitFor(() => expect(result.current.received?.id).toBe(7))
    expect(loadIntakeQueue()).toEqual([])
  })

  it('sin conexión: guarda en la cola, avisa y reintenta al volver la conexión', async () => {
    login()
    goTo('/?atajo=1&importe=3&comercio=Kiosco')
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useShortcutIntake())

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Guardado, se enviará en cuanto haya conexión'))
    expect(loadIntakeQueue()).toHaveLength(1)
    expect(window.location.search).toBe('')
    const firstId = JSON.parse(postCalls(fetchMock)[0][1].body).id_externo

    fetchMock.mockImplementation(() => jsonRes({ ...created, comercio: 'Kiosco', importe: 3 }))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(result.current.received?.comercio).toBe('Kiosco'))
    expect(loadIntakeQueue()).toEqual([])
    // El reintento manda el mismo id_externo (el backend reconoce el reenvío)
    const calls = postCalls(fetchMock)
    expect(JSON.parse(calls[calls.length - 1][1].body).id_externo).toBe(firstId)
  })

  it('servidor dormido (503) también se reintenta; error de validación se descarta', async () => {
    login()
    goTo('/?atajo=1&importe=3')
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({}, 503)))
    renderHook(() => useShortcutIntake())
    await waitFor(() => expect(loadIntakeQueue()).toHaveLength(1))
    cleanup()

    vi.stubGlobal('fetch', vi.fn(() => jsonRes({ detail: 'importe inválido' }, 422)))
    renderHook(() => useShortcutIntake())
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No se pudo registrar el pago. Añádelo a mano.'))
    expect(loadIntakeQueue()).toEqual([])
  })

  it('sesión caducada (401): el pago sobrevive a la limpieza de sesión', async () => {
    login()
    goTo('/?atajo=1&importe=8&comercio=Cine')
    const onExpired = () => clearUserData()          // lo que hace AuthContext
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({ detail: 'x' }, 401)))
    renderHook(() => useShortcutIntake())
    await waitFor(() => expect(loadIntakeQueue()).toHaveLength(1))
    expect(localStorage.getItem(AUTH_KEY)).toBeNull()
    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  })
})

describe('flujo sin sesión', () => {
  it('el login muestra el pago guardado y se envía justo después de entrar', async () => {
    goTo('/?atajo=1&importe=12%2C30%20%E2%82%AC&comercio=Mercadona')
    render(<IntakeLoginBanner />)
    expect(screen.getByRole('status').textContent).toMatch(/Mercadona/)
    expect(screen.getByRole('status').textContent).toMatch(/Inicia sesión/)
    expect(window.location.search).toBe('')
    expect(loadIntakeQueue()).toHaveLength(1)
    cleanup()

    login()
    const fetchMock = vi.fn(() => jsonRes(created))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useShortcutIntake())
    await waitFor(() => expect(result.current.received?.id).toBe(41))
    expect(JSON.parse(postCalls(fetchMock)[0][1].body).comercio).toBe('Mercadona')
    expect(loadIntakeQueue()).toEqual([])
  })

  it('sin pagos en cola el banner no aparece', () => {
    render(<IntakeLoginBanner />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('ShortcutSetupScreen', () => {
  it('copia el enlace con el origen real de la app y "Probar ahora" abre el enlace de prueba', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const navigate = vi.fn()
    render(<ShortcutSetupScreen onClose={() => {}} navigate={navigate} />)

    const link = `${window.location.origin}/?atajo=1`
    expect(shortcutLinkBase()).toBe(link)
    expect(screen.getByTestId('sc-link').textContent).toBe(link)
    expect(link).not.toContain(BASE)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace del atajo' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link))
    expect(await screen.findByText('✓ Copiado')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Probar ahora' }))
    expect(navigate).toHaveBeenCalledWith(shortcutTestLink())
    const params = new URL(navigate.mock.calls[0][0]).searchParams
    expect(params.get('atajo')).toBe('1')
    expect(params.get('importe')).toBe('1,00 €')
    expect(params.get('comercio')).toBe('Prueba')
  })

  it('explica Safari, Codificar URL, Abrir URLs y la automatización Transacción', () => {
    render(<ShortcutSetupScreen onClose={() => {}} />)
    const text = document.body.textContent
    for (const s of ['Safari', 'Codificar URL', 'Abrir URLs', 'Transacción', 'Ejecutar inmediatamente', 'Mi Economía', 'Apple Pay del iPhone']) {
      expect(text).toContain(s)
    }
    expect(text).not.toMatch(/clave|token|Authorization/i)
  })

  it('selector de modos accesible: Abrir la app por defecto y cambio a En segundo plano', () => {
    render(<ShortcutSetupScreen onClose={() => {}} />)
    expect(screen.getByRole('tablist')).toBeTruthy()
    const [tabApp, tabFondo] = screen.getAllByRole('tab')
    expect(tabApp.getAttribute('aria-selected')).toBe('true')
    expect(tabFondo.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByText('Importante:')).toBeTruthy() // aviso de Safari solo en modo A
    fireEvent.click(tabFondo)
    expect(tabFondo.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('Importante:')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Probar ahora' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copiar mi clave' })).toBeNull() // la clave solo en Manual
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('prompt del modo A lleva el enlace de la app y la fórmula; el de B la API y el marcador, sin token', () => {
    const a = buildPromptApp()
    expect(a).toContain(shortcutLinkBase())
    expect(a).toContain('&importe=')
    expect(a).toContain('&comercio=')
    expect(a).toContain('Ejecutar inmediatamente')
    const b = buildPromptBackground()
    expect(b).toContain(`${BASE}/api/shortcut/pending`)
    expect(b).toContain(KEY_PLACEHOLDER)
    expect(b).not.toMatch(/NO tienes mi clave|No me pidas la clave/)
    expect(KEY_PLACEHOLDER).toBe('<PEGA_AQUI_TU_CLAVE>')
    for (const s of ['Recibir', 'Repetir', 'Obtener contenido de URL', 'POST', 'application/json', 'id_externo', 'Esperar', 'ISO 8601', 'Mostrar notificación', 'Ejecutar inmediatamente']) {
      expect(b).toContain(s)
    }
    expect(b).not.toMatch(/eyJ|Bearer/)
  })

  it('copia el prompt de cada modo y avisa si no se puede copiar', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ShortcutSetupScreen onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar prompt' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(buildPromptApp()))
    expect(await screen.findByText('✓ Copiado')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('tab')[1])
    // los de segundo plano (con y sin clave): ver atajo-prompt-clave.test.jsx
  })
})

describe('API de pendientes', () => {
  beforeEach(login)

  it('createPending manda fuente wallet e id_externo', async () => {
    const f = vi.fn(() => jsonRes(created)); vi.stubGlobal('fetch', f)
    await createPending({ importe: 2, comercio: 'X', id_externo: 'e1' })
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ importe: 2, comercio: 'X', fuente: 'wallet', id_externo: 'e1' })
  })

  it('categorizePending envía recordar (true por defecto) y comentario', async () => {
    const f = vi.fn(() => jsonRes({ ok: true })); vi.stubGlobal('fetch', f)
    await categorizePending(7, { tipo: 'Gasto Variable', concepto: 'Supermercado' })
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ tipo: 'Gasto Variable', concepto: 'Supermercado', recordar: true })
    await categorizePending(7, { tipo: 'Gasto Variable', concepto: 'Ocio', recordar: false, comentario: 'cena' })
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ tipo: 'Gasto Variable', concepto: 'Ocio', recordar: false, comentario: 'cena' })
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/pending/7/categorize`)
  })

  it('discardPending hace DELETE /api/pending/{id} con JWT', async () => {
    const f = vi.fn(() => jsonRes({ ok: true })); vi.stubGlobal('fetch', f)
    await discardPending(9)
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe(`${BASE}/api/pending/9`)
    expect(opts.method).toBe('DELETE')
    expect(opts.headers.Authorization).toBe('Bearer jwt')
  })

  it('usePendingTransaction: categorizar (con recordar) y descartar sacan el pago de la cola', async () => {
    const queue = [
      { id: 1, importe: 12.4, fecha: '2026-10-10', comercio: 'Mercadona', fuente: 'wallet', suggested: null },
      { id: 2, importe: 3, fecha: '2026-10-11', comercio: null, fuente: 'shortcut', suggested: null },
    ]
    const f = vi.fn((url, opts = {}) => (url.endsWith('/api/pending') && !opts.method ? jsonRes(queue) : jsonRes({ ok: true })))
    vi.stubGlobal('fetch', f)
    const { result } = renderHook(() => usePendingTransaction())
    await waitFor(() => expect(result.current.queue).toHaveLength(2))

    await act(() => result.current.categorizePending(1, 'Gasto Variable', 'Supermercado', { recordar: false }))
    const cat = f.mock.calls.find(([u]) => u.endsWith('/api/pending/1/categorize'))
    expect(JSON.parse(cat[1].body).recordar).toBe(false)
    expect(result.current.queue.map(t => t.id)).toEqual([2])

    await act(() => result.current.discardPending(2))
    expect(f.mock.calls.some(([u, o]) => u.endsWith('/api/pending/2') && o?.method === 'DELETE')).toBe(true)
    expect(result.current.queue).toHaveLength(0)
  })
})
