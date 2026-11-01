// Fallos de QA: aviso al compartir meta, Escape del visor de foto y dedup de GET /api/goals.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import GoalDetailModal from '../src/components/ui/goals/GoalDetailModal'
import SavingsGoals from '../src/components/ui/SavingsGoals'
import { AuthProvider } from '../src/context/AuthContext'
import { clearPhotoCache, fetchGoals, shareGoal } from '../src/services/api'
import { AUTH_KEY } from '../src/utils/storageKeys'

const showToast = vi.fn()
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast }) }))

const goal = {
  id: 3, nombre: 'Viaje', objetivo: 1000, ahorrado: 150, emoji: '✈️', created_by: 'a@a.com', members: ['a@a.com'],
  contributions: [{ id: 11, importe: 50, fecha: '2026-01-02', user_email: 'a@a.com', name: 'A', tiene_foto: true }],
}
const noop = () => {}
const modal = (props = {}) => render(<GoalDetailModal goal={goal} myEmail="a@a.com" onClose={noop} onAddMoney={noop}
  onShare={noop} onEdit={noop} onDelete={noop} onDeleteContribution={noop} {...props} />)

beforeEach(() => { clearPhotoCache(); localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function openShare() {
  fireEvent.click(screen.getByText('Compartir'))
  fireEvent.change(screen.getByPlaceholderText('nombre@correo.com'), { target: { value: 'b@b.com' } })
  fireEvent.click(screen.getByText('Invitar'))
}

describe('compartir meta', () => {
  it('429: mensaje de demasiadas veces y la hoja sigue abierta', async () => {
    const err = Object.assign(new Error('API 429'), { status: 429 })
    modal({ onShare: vi.fn().mockRejectedValue(err) })
    openShare()
    expect(await screen.findByText('Has compartido demasiadas veces. Inténtalo más tarde.')).toBeTruthy()
    expect(screen.getByText('Compartir meta')).toBeTruthy()
  })

  it('422: muestra el detail legible y no cierra', async () => {
    modal({ onShare: vi.fn().mockRejectedValue(Object.assign(new Error('Email no válido'), { status: 422 })) })
    openShare()
    expect(await screen.findByText('Email no válido')).toBeTruthy()
    expect(screen.getByText('Compartir meta')).toBeTruthy()
  })

  it('éxito: cierra la hoja', async () => {
    modal({ onShare: vi.fn().mockResolvedValue('ok') })
    openShare()
    await waitFor(() => expect(screen.queryByText('Compartir meta')).toBeNull())
  })

  it('shareGoal devuelve el mensaje y SavingsGoals lo muestra con showToast (o uno por defecto)', async () => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ email: 'a@a.com', name: 'A', sessionToken: 't' }))
    let mensaje = 'Si la cuenta existe, se ha compartido la meta'
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const body = String(url).endsWith('/share') ? { ...goal, mensaje } : [goal]
      return { status: 200, ok: true, json: async () => body }
    }))
    showToast.mockClear()
    render(<AuthProvider><SavingsGoals /></AuthProvider>)
    fireEvent.click(await screen.findByText('Viaje'))
    await screen.findByText('Compartir')
    openShare()
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(mensaje))
    expect((await shareGoal(3, 'x@x.com')).mensaje).toBe(mensaje)
    mensaje = undefined
    fireEvent.click(await screen.findByText('Compartir'))
    fireEvent.change(screen.getByPlaceholderText('nombre@correo.com'), { target: { value: 'c@c.com' } })
    fireEvent.click(screen.getByText('Invitar'))
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(2))
    expect(showToast.mock.calls[1][0]).toMatch(/compartido/)
  })
})

describe('Escape en el visor de foto', () => {
  it('cierra solo el visor, no la pantalla de la meta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ foto: 'data:image/jpeg;base64,AAA' }) })))
    const onClose = vi.fn()
    modal({ onClose })
    const btn = screen.getByLabelText('Ver foto')
    btn.focus()
    fireEvent.click(btn)
    await screen.findByAltText('Recuerdo')
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    expect(screen.queryByAltText('Recuerdo')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(btn)
    fireEvent.keyDown(document.body, { key: 'Escape' }) // segundo Escape: ahora sí cierra la meta
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/goals compartido', () => {
  it('peticiones simultáneas hacen una sola llamada; después de resolver, otra nueva', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => { n++; await Promise.resolve(); return { status: 200, ok: true, json: async () => [goal] } }))
    const [a, b] = await Promise.all([fetchGoals(), fetchGoals()])
    expect(n).toBe(1)
    expect(a).toBe(b)
    await fetchGoals()
    expect(n).toBe(2)
  })

  it('una escritura invalida la petición en vuelo', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => { n++; return { status: 200, ok: true, json: async () => [] } }))
    const p1 = fetchGoals()
    const w = shareGoal(3, 'x@x.com')
    const p2 = fetchGoals()
    await Promise.all([p1, w, p2])
    expect(n).toBe(3)
  })
})
