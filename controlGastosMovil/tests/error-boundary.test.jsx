import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { lazy, Suspense, useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ErrorBoundary, { isChunkLoadError, reloadOnceForChunkError, installPreloadErrorHandler } from '../src/components/ui/ErrorBoundary'

const root = join(__dirname, '..')
let reload

beforeEach(() => {
  sessionStorage.clear()
  reload = vi.fn()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const chunkErr = () => new TypeError('Failed to fetch dynamically imported module: https://x/assets/Modal-abc.js')

function Harness({ importer }) {
  const [Lazy] = useState(() => lazy(importer))
  const [open, setOpen] = useState(true)
  return (
    <div>
      <header>Cabecera</header>
      <nav>Pestañas</nav>
      <ErrorBoundary onClose={() => setOpen(false)}>
        <Suspense fallback={null}>{open && <Lazy />}</Suspense>
      </ErrorBoundary>
    </div>
  )
}

describe('ErrorBoundary', () => {
  it('detecta errores de chunk', () => {
    expect(isChunkLoadError(chunkErr())).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true)
    expect(isChunkLoadError(new Error('otra cosa'))).toBe(false)
  })

  it('un modal lazy que falla no tumba el resto y Cerrar lo quita sin recargar', async () => {
    sessionStorage.setItem('chunk-reload-at', String(Date.now())) // ya recargó hace poco
    render(<Harness importer={() => Promise.reject(chunkErr())} />)
    await screen.findByText(/No se ha podido abrir esto/)
    expect(screen.getByText('Cabecera')).toBeTruthy()
    expect(screen.getByText('Pestañas')).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Cerrar'))
    expect(screen.queryByText(/No se ha podido abrir esto/)).toBeNull()
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText('Cabecera')).toBeTruthy()
  })

  it('el botón Recargar recarga y el fallback no enseña el stack', async () => {
    sessionStorage.setItem('chunk-reload-at', String(Date.now()))
    const boom = new Error('SECRETO-INTERNO'); boom.stack = 'Error: SECRETO-INTERNO\n at Foo (bar.js:1:1)'
    render(<Harness importer={() => Promise.resolve({ default: () => { throw boom } })} />)
    await screen.findByText(/No se ha podido abrir esto/)
    expect(document.body.textContent).not.toMatch(/SECRETO-INTERNO|bar\.js/)
    fireEvent.click(screen.getByText('Recargar'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('el error de chunk recarga una sola vez', async () => {
    render(<Harness importer={() => Promise.reject(chunkErr())} />)
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(sessionStorage.getItem('chunk-reload-at')).toBeTruthy()
    expect(reloadOnceForChunkError()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reloadOnceForChunkError(Date.now() + 61_000)).toBe(true)
  })

  it('un error normal no recarga', async () => {
    render(<Harness importer={() => Promise.resolve({ default: () => { throw new Error('x') } })} />)
    await screen.findByText(/No se ha podido abrir esto/)
    expect(reload).not.toHaveBeenCalled()
  })

  it('vite:preloadError recarga una vez y tolera sessionStorage roto', () => {
    const off = installPreloadErrorHandler()
    const ev = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(ev)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(reload).toHaveBeenCalledTimes(1)
    off()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(reloadOnceForChunkError()).toBe(false)
  })
})

describe('viewport y tamaño de fuente en campos', () => {
  it('index.html fija el viewport sin zoom', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    expect(html).toMatch(/name="viewport" content="width=device-width, initial-scale=1\.0, maximum-scale=1\.0, user-scalable=no, viewport-fit=cover"/)
  })

  it('ninguna regla de input/textarea/select baja de 16px', () => {
    const css = readFileSync(join(root, 'src/App.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const bad = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim()
      if (!/(^|[\s,.])(input|textarea|select)\b|login-input|search-input|fm-input|textarea\.sc-prompt/.test(sel)) continue
      const fs = m[2].match(/font-size:\s*([^;]+);/)
      if (!fs) continue
      if (!/max\(16px|var\(--fs-(lg|xl|2xl|hero|display)\)/.test(fs[1])) bad.push(`${sel} -> ${fs[1]}`)
    }
    expect(bad).toEqual([])
    expect(css).toMatch(/textarea\.sc-prompt\s*\{[^}]*font-size:\s*max\(16px/)
  })
})
