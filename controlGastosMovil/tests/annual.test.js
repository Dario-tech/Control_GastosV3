import { describe, it, expect, vi, afterEach } from 'vitest'
import { annualProgress, dueState } from '../src/components/ui/annual/annualUtils'

afterEach(() => vi.useRealTimers())

describe('annualProgress', () => {
  it('null sin reparto', () => {
    expect(annualProgress({ meses_reparto: [] })).toBeNull()
    expect(annualProgress({})).toBeNull()
  })
  it('cuenta los meses ya pasados (incluido el actual)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 2, 10)) // marzo
    const r = annualProgress({ meses_reparto: [1, 2, 3, 4], reparto_mensual: 100, importe: 400 })
    expect(r).toEqual({ pasados: 3, total: 4, pagado: 300, pendiente: 100 })
  })
})

describe('dueState', () => {
  it('vencido', () => {
    expect(dueState({ dias_restantes: -1 }).label).toBe('Vencido hace 1 día')
    expect(dueState({ dias_restantes: -3 })).toMatchObject({ key: 'overdue', label: 'Vencido hace 3 días' })
  })
  it('hoy, pronto y lejos', () => {
    expect(dueState({ dias_restantes: 0 })).toMatchObject({ key: 'soon', label: 'Vence hoy' })
    expect(dueState({ dias_restantes: 1 }).label).toBe('En 1 día')
    expect(dueState({ dias_restantes: 30 }).key).toBe('soon')
    expect(dueState({ dias_restantes: 90 })).toMatchObject({ key: 'far', label: 'En 90 días' })
    expect(dueState({ dias_restantes: 90, aviso_activo: true }).key).toBe('soon')
  })
})
