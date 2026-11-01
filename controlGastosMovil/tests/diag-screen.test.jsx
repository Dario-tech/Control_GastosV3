import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DiagScreen, { medir } from '../src/components/ui/DiagScreen'

describe('DiagScreen', () => {
  it('se renderiza sin sesión ni datos, con botón Copiar y mediciones', () => {
    render(<DiagScreen />)
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy()
    expect(document.querySelector('pre').textContent).toContain('innerWidth x innerHeight')
    expect(document.querySelector('pre').textContent).toContain('display-mode standalone')
  })
  it('medir no falla sin visualViewport ni matchMedia', () => {
    expect(() => medir(document, { ...window, visualViewport: undefined, matchMedia: undefined, navigator: { userAgent: 'x' }, screen: { width: 1, height: 1 }, getComputedStyle: window.getComputedStyle.bind(window) })).not.toThrow()
  })
})
