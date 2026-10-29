import { describe, it, expect } from 'vitest'
import { safeTopFloor } from '../src/utils/safeAreaFloor'

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
const base = { declared: 0, ua: iphone, touch: true }

describe('safeTopFloor', () => {
  it('no toca nada si iOS declara una zona segura real', () => {
    expect(safeTopFloor({ ...base, declared: 59, screenW: 393, screenH: 852 })).toBe(0)
  })
  it('reserva un mínimo en iPhone con isla o muesca cuando iOS declara 0', () => {
    expect(safeTopFloor({ ...base, screenW: 440, screenH: 956 })).toBe(59)
    expect(safeTopFloor({ ...base, screenW: 402, screenH: 874 })).toBe(54)
    expect(safeTopFloor({ ...base, screenW: 390, screenH: 844 })).toBe(47)
  })
  it('no reserva nada en iPhone SE, Android ni escritorio', () => {
    expect(safeTopFloor({ ...base, screenW: 375, screenH: 667 })).toBe(0)
    expect(safeTopFloor({ ...base, ua: 'Mozilla/5.0 (Linux; Android 14)', screenW: 412, screenH: 915 })).toBe(0)
    expect(safeTopFloor({ ...base, touch: false, screenW: 1440, screenH: 900 })).toBe(0)
  })
})
