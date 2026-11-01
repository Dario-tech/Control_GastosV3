// Pantalla de Atajos: «Copiar prompt» (segundo plano) mete la clave en el portapapeles
// sin pintarla; modo Abrir la app sin clave; modo Manual con los dos tipos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AUTH_KEY } from '../src/utils/storageKeys'
import { BASE } from '../src/services/api'
import ShortcutSetupScreen, { buildPromptBackground, KEY_PLACEHOLDER, KEY_WARNING } from '../src/components/ui/ShortcutSetupScreen'

const KEY = 'CLAVE-INVENTADA-123'
const jsonRes = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

function setClipboard(impl) {
  Object.defineProperty(navigator, 'clipboard', { value: impl, configurable: true })
}
const goFondo = () => fireEvent.click(screen.getAllByRole('tab')[1])
const copyBtn = () => screen.getByRole('button', { name: /Copiar prompt con mi clave|Copiando|Copiado/ })
const copyBtnApp = () => screen.getByRole('button', { name: /Copiar prompt|Copiado/ })
const noKeyBtn = () => screen.getByRole('button', { name: /Copiar prompt sin clave|Copiado/ })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(AUTH_KEY, JSON.stringify({ email: 'a@a.es', name: 'Ana', sessionToken: 'jwt' }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Copiar prompt en segundo plano', () => {
  it('copia el prompt con la clave real (sin marcador) y la pantalla nunca la muestra', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    const f = vi.fn(() => jsonRes({ shortcut_token: KEY })); vi.stubGlobal('fetch', f)
    render(<ShortcutSetupScreen onClose={() => {}} />)
    goFondo()

    expect(screen.getByTestId('sc-prompt').textContent).toContain(KEY_PLACEHOLDER)
    expect(screen.getByText(KEY_WARNING)).toBeTruthy()
    expect(f).not.toHaveBeenCalled()

    fireEvent.click(copyBtn())
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0][0]
    expect(copied).toBe(buildPromptBackground(BASE, KEY))
    expect(copied).toContain(`«shortcut_token» = ${KEY}`)
    expect(copied).not.toContain(KEY_PLACEHOLDER)
    expect(copied).not.toMatch(/NO tienes mi clave|No me pidas la clave/)
    expect(copied).toContain('NO la repitas ni la muestres')
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/shortcut/token`)

    expect(await screen.findByText('✓ Copiado')).toBeTruthy()
    expect(screen.getAllByRole('status').some(n => n.textContent === 'Copiado')).toBe(true)
    expect(screen.getByTestId('sc-prompt').textContent).not.toContain(KEY)
    expect(document.body.innerHTML).not.toContain(KEY)
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(KEY)
  })

  it('con ClipboardItem usa clipboard.write con la promesa del texto (gesto de Safari)', async () => {
    const write = vi.fn(async ([item]) => {
      const blob = await item.items['text/plain']
      write.text = await blob.text()
    })
    setClipboard({ write, writeText: vi.fn() })
    vi.stubGlobal('ClipboardItem', class { constructor(items) { this.items = items } })
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({ shortcut_token: KEY })))
    render(<ShortcutSetupScreen onClose={() => {}} />)
    goFondo()
    fireEvent.click(copyBtn())
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(write.text).toBe(buildPromptBackground(BASE, KEY)))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('si getShortcutToken falla no copia nada y avisa en español', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({}, 401)))
    render(<ShortcutSetupScreen onClose={() => {}} />)
    goFondo()
    fireEvent.click(copyBtn())
    expect(await screen.findByText(/sesión ha caducado/)).toBeTruthy()
    expect(writeText).not.toHaveBeenCalled()

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    fireEvent.click(copyBtn())
    expect(await screen.findByText(/No hay conexión con el servidor/)).toBeTruthy()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('plan B: si el portapapeles falla pide pulsar otra vez y reutiliza la clave sin pedirla de nuevo', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('gesto')).mockResolvedValue(undefined)
    setClipboard({ writeText })
    const f = vi.fn(() => jsonRes({ shortcut_token: KEY })); vi.stubGlobal('fetch', f)
    render(<ShortcutSetupScreen onClose={() => {}} />)
    goFondo()
    fireEvent.click(copyBtn())
    expect(await screen.findByText('Pulsa otra vez para copiar')).toBeTruthy()
    expect(document.body.innerHTML).not.toContain(KEY)

    fireEvent.click(copyBtn())
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls[1][0]).toBe(buildPromptBackground(BASE, KEY))
    expect(f).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('✓ Copiado')).toBeTruthy()
    expect(screen.queryByText('Pulsa otra vez para copiar')).toBeNull()
  })

  it('último recurso: textarea de solo lectura con el prompt, que se oculta al terminar', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('no')) })
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({ shortcut_token: KEY })))
    render(<ShortcutSetupScreen onClose={() => {}} />)
    goFondo()
    fireEvent.click(copyBtn())
    await screen.findByText('Pulsa otra vez para copiar')
    fireEvent.click(copyBtn())
    const ta = await screen.findByLabelText('Texto para copiar a mano')
    expect(ta.readOnly).toBe(true)
    expect(ta.value).toBe(buildPromptBackground(BASE, KEY))
    fireEvent.click(screen.getByRole('button', { name: 'Ya lo he copiado' }))
    expect(screen.queryByLabelText('Texto para copiar a mano')).toBeNull()
    expect(document.body.innerHTML).not.toContain(KEY)
  })
})

describe('Copiar prompt sin clave (segundo plano)', () => {
  it('copia el prompt con el marcador, sin llamar al servidor', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    const f = vi.fn(() => jsonRes({ shortcut_token: KEY })); vi.stubGlobal('fetch', f)
    render(<ShortcutSetupScreen onClose={() => {}} />)
    goFondo()
    expect(screen.getByRole('button', { name: 'Copiar prompt con mi clave' })).toBeTruthy()
    fireEvent.click(noKeyBtn())
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0][0]
    expect(copied).toBe(buildPromptBackground())
    expect(copied).toContain(KEY_PLACEHOLDER)
    expect(f).not.toHaveBeenCalled()
    expect(await screen.findByText('✓ Copiado')).toBeTruthy()
    expect(screen.getAllByRole('status').some(n => n.textContent === 'Copiado')).toBe(true)
  })

  it('si el portapapeles falla avisa en español', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('no')) })
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    render(<ShortcutSetupScreen onClose={() => {}} />)
    goFondo()
    fireEvent.click(noKeyBtn())
    expect(await screen.findByText(/No se pudo copiar automáticamente/)).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('Aviso único de la clave', () => {
  it('es el mismo texto en segundo plano y en Manual, y no promete cambiar la clave', () => {
    render(<ShortcutSetupScreen onClose={() => {}} />)
    goFondo()
    expect(screen.getByText(KEY_WARNING)).toBeTruthy()
    expect(KEY_WARNING).not.toMatch(/botón|cambiarla ahora|avísanos/i)
    fireEvent.click(screen.getAllByRole('tab')[2])
    expect(document.body.textContent).toContain(KEY_WARNING)
    expect(document.body.textContent).not.toContain('No la pegues en ninguna IA')
    expect(document.body.textContent).toContain('«Copiar mi clave» de arriba')
  })
})

describe('Modo Abrir la app', () => {
  it('no pide clave, su prompt lleva el enlace real y los pasos completos', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    render(<ShortcutSetupScreen onClose={() => {}} />)
    fireEvent.click(copyBtnApp())
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0][0]
    expect(f).not.toHaveBeenCalled()
    expect(text).toContain(`${window.location.origin}/?atajo=1&importe=`)
    for (const s of ['Recibir Transacciones de Cartera', 'Codificar URL 1', 'Codificar URL 2', '«Texto»', 'Abrir URLs', 'Transacción', 'Ejecutar inmediatamente', 'sin pagar', 'importe=1%2C00%20%E2%82%AC&comercio=Prueba']) {
      expect(text).toContain(s)
    }
    expect(text.indexOf('&importe=[')).toBeLessThan(text.indexOf('&comercio=['))
    expect(screen.queryByText(KEY_WARNING)).toBeNull()
  })
})

describe('Modo Manual', () => {
  it('muestra los pasos de los dos tipos y copia la clave sin mostrarla', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({ shortcut_token: KEY })))
    render(<ShortcutSetupScreen onClose={() => {}} />)
    fireEvent.click(screen.getAllByRole('tab')[2])
    const t = document.body.textContent
    for (const s of ['Tipo «Abrir la app»', 'Tipo «En segundo plano»', 'Codificar URL', 'Abrir URLs', 'Obtener contenido de URL', 'Content-Type',
      'application/json', 'shortcut_token', 'importe', 'comercio', 'id_externo', 'Repetir', '3 veces', 'Esperar', 'Transacción', 'Ejecutar inmediatamente']) {
      expect(t).toContain(s)
    }
    expect(screen.getByTestId('sc-man-api').textContent).toBe(`${BASE}/api/shortcut/pending`)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mi clave' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(KEY))
    expect(await screen.findByText(/Clave copiada/)).toBeTruthy()
    expect(document.body.innerHTML).not.toContain(KEY)
    expect(JSON.stringify({ ...localStorage })).not.toContain(KEY)
  })

  it('las flechas del selector recorren los tres modos en ambos sentidos', () => {
    render(<ShortcutSetupScreen onClose={() => {}} />)
    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' })
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  })
})
