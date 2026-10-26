// Fotos de aportaciones: GET /api/goals solo trae `tiene_foto`; la foto se pide al abrirla.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import GoalDetailModal from '../src/components/ui/goals/GoalDetailModal'
import { clearPhotoCache, fetchContributionPhoto } from '../src/services/api'

const goal = {
  id: 3, nombre: 'Viaje', objetivo: 1000, ahorrado: 150, emoji: '✈️', created_by: 'a@a.com', members: ['a@a.com'],
  contributions: [
    { id: 11, importe: 50, fecha: '2026-01-02', user_email: 'a@a.com', name: 'A', tiene_foto: true },
    { id: 12, importe: 100, fecha: '2026-01-03', user_email: 'a@a.com', name: 'A', tiene_foto: false },
  ],
}
const noop = () => {}
const open = () => render(<GoalDetailModal goal={goal} myEmail="a@a.com" onClose={noop} onAddMoney={noop}
  onShare={noop} onEdit={noop} onDelete={noop} onDeleteContribution={noop} />)

let calls, mode
beforeEach(() => {
  clearPhotoCache(); localStorage.clear(); calls = []; mode = 'ok'
  vi.stubGlobal('fetch', vi.fn(async url => {
    calls.push(String(url))
    if (mode === 'fail') return { status: 500, ok: false, json: async () => ({}) }
    return { status: 200, ok: true, json: async () => ({ foto: 'data:image/jpeg;base64,AAA' }) }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('fotos de aportaciones a demanda', () => {
  it('al renderizar no pide ninguna foto y solo ofrece verla donde tiene_foto', () => {
    open()
    expect(calls).toHaveLength(0)
    expect(screen.getAllByLabelText('Ver foto')).toHaveLength(1)
  })

  it('al abrir pide la foto, la muestra y la reutiliza de la caché en memoria', async () => {
    open()
    fireEvent.click(screen.getByLabelText('Ver foto'))
    expect((await screen.findByAltText('Recuerdo')).getAttribute('src')).toBe('data:image/jpeg;base64,AAA')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/\/api\/goals\/3\/contributions\/11\/foto$/)
    fireEvent.click(screen.getByLabelText('Cerrar foto'))
    fireEvent.click(screen.getByLabelText('Ver foto'))
    expect(await screen.findByAltText('Recuerdo')).toBeTruthy()
    expect(calls).toHaveLength(1)
    expect(Object.keys(localStorage).some(k => (localStorage.getItem(k) || '').includes('AAA'))).toBe(false)
  })

  it('muestra «cargando» y, si falla, error con Reintentar que vuelve a pedirla', async () => {
    mode = 'fail'
    open()
    fireEvent.click(screen.getByLabelText('Ver foto'))
    expect(screen.getByText(/Cargando foto/)).toBeTruthy()
    const retry = await screen.findByText('Reintentar')
    expect(calls).toHaveLength(1)
    mode = 'ok'
    fireEvent.click(retry)
    expect(await screen.findByAltText('Recuerdo')).toBeTruthy()
    expect(calls).toHaveLength(2)
  })

  it('dos peticiones simultáneas de la misma aportación comparten una sola llamada', async () => {
    await Promise.all([fetchContributionPhoto(3, 11), fetchContributionPhoto(3, 11)])
    expect(calls).toHaveLength(1)
  })
})
