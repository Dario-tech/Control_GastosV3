import { describe, it, expect, afterEach, vi } from 'vitest'
import { todayLocal, addDaysLocal, localISODate } from '../src/utils'

describe('fechas locales (Hoy/Ayer)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('todayLocal usa la fecha local, no la UTC (00:30 local)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 10, 0, 30)) // 10 mar 00:30 hora local
    expect(todayLocal()).toBe('2026-03-10')
    expect(addDaysLocal(-1)).toBe('2026-03-09')
    expect(addDaysLocal(1)).toBe('2026-03-11')
  })

  it('00:30 en UTC+2 simulado: el día UTC es el anterior pero hoy es el local', () => {
    // 2026-06-10T22:30Z == 11 jun 00:30 en Europe/Madrid (CEST).
    const d = new Date('2026-06-10T22:30:00Z')
    const fake = { getFullYear: () => 2026, getMonth: () => 5, getDate: () => 11 } // lo que vería un dispositivo UTC+2
    expect(d.toISOString().slice(0, 10)).toBe('2026-06-10') // el bug antiguo
    expect(localISODate(fake)).toBe('2026-06-11')
  })

  it('ayer cruza fin de mes/año por calendario', () => {
    expect(addDaysLocal(-1, new Date(2026, 0, 1, 0, 30))).toBe('2025-12-31')
    expect(addDaysLocal(-1, new Date(2026, 2, 1, 0, 30))).toBe('2026-02-28')
  })

  it('no resta 86400000 ms: el día del cambio de hora ayer sigue siendo ayer', () => {
    // Sea cual sea la zona, restar días por calendario nunca salta ni repite día.
    const from = new Date(2026, 2, 30, 0, 30) // día posterior al cambio de hora en Europa
    expect(addDaysLocal(-1, from)).toBe('2026-03-29')
  })
})
