import { describe, it, expect, vi, afterEach } from 'vitest'
import { newId } from '../src/utils/id'

describe('newId', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
  it('devuelve strings únicos', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()))
    expect(ids.size).toBe(1000)
  })
  it('fallback sin crypto.randomUUID, con reloj congelado', () => {
    vi.stubGlobal('crypto', {})
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 0, 1))
    const ids = new Set(Array.from({ length: 1000 }, () => newId()))
    expect(ids.size).toBe(1000)
    expect(typeof newId()).toBe('string')
  })
})
