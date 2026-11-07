import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import ShortcutSetupScreen, { buildPromptAndroid, KEY_PLACEHOLDER, KEY_WARNING, MACRODROID_URL } from '../src/components/ui/ShortcutSetupScreen'
import { BASE } from '../src/services/api'

const KEY = 'clave-android-de-prueba-123'
const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() })
const setClipboard = v => Object.defineProperty(navigator, 'clipboard', { value: v, configurable: true })

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Pagos automáticos · Android', () => {
  it('por defecto muestra iPhone y el selector cambia a Android', () => {
    render(<ShortcutSetupScreen onClose={() => {}} />)
    expect(screen.getAllByRole('tab').length).toBe(3)
    fireEvent.click(screen.getByTestId('sc-platform-android'))
    expect(screen.queryAllByRole('tab').length).toBe(0)
    expect(screen.getByTestId('sc-open-macrodroid').getAttribute('href')).toBe(MACRODROID_URL)
    expect(screen.getByTestId('sc-prompt').textContent).toContain('MacroDroid')
    fireEvent.click(screen.getByTestId('sc-platform-ios'))
    expect(screen.getAllByRole('tab').length).toBe(3)
  })

  it('el prompt visible lleva el marcador y apunta a la API de pendientes', () => {
    const p = buildPromptAndroid()
    expect(p).toContain(`${BASE}/api/shortcut/pending`)
    expect(p).toContain(`«shortcut_token» = ${KEY_PLACEHOLDER}`)
    expect(p).toContain('NO la repitas ni la muestres')
  })

  it('copia el prompt con la clave real sin pintarla en pantalla', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    const f = vi.fn(() => jsonRes({ shortcut_token: KEY })); vi.stubGlobal('fetch', f)
    render(<ShortcutSetupScreen onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('sc-platform-android'))
    expect(screen.getByText(KEY_WARNING)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar prompt con mi clave' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toBe(buildPromptAndroid(BASE, KEY))
    expect(writeText.mock.calls[0][0]).not.toContain(KEY_PLACEHOLDER)
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/shortcut/token`)
    expect(document.body.innerHTML).not.toContain(KEY)
  })
})
