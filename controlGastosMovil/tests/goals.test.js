import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { goalRemaining, toIso, addMonthsIso } from '../src/components/ui/goals/goalUtils'

vi.mock('../src/services/api', () => ({
  fetchGoals: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(), deleteGoal: vi.fn(),
  contributeToGoal: vi.fn(), deleteContribution: vi.fn(), shareGoal: vi.fn(),
}))
import * as api from '../src/services/api'
import { useSavingsGoals } from '../src/hooks/useSavingsGoals'

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('goalUtils', () => {
  it('goalRemaining sin fecha', () => {
    expect(goalRemaining({ objetivo: 1000, ahorrado: 250 })).toEqual({ falta: 750, mes: null })
  })
  it('goalRemaining nunca negativo y sin aporte mensual si ya se cumplió', () => {
    expect(goalRemaining({ objetivo: 100, ahorrado: 300, fecha: '2099-01-01' })).toEqual({ falta: 0, mes: null })
  })
  it('goalRemaining reparte lo que falta entre los meses restantes', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 0, 15))
    const r = goalRemaining({ objetivo: 1000, ahorrado: 400, fecha: '2026-07-15' })
    expect(r.falta).toBe(600)
    expect(r.mes).toBe(100) // 6 meses
  })
  it('goalRemaining con fecha pasada o inválida no da aporte mensual', () => {
    expect(goalRemaining({ objetivo: 100, ahorrado: 0, fecha: '2000-01-01' }).mes).toBeNull()
    expect(goalRemaining({ objetivo: 100, ahorrado: 0, fecha: 'xx' }).mes).toBeNull()
  })
  it('toIso usa fecha local con ceros', () => {
    expect(toIso(new Date(2026, 2, 5))).toBe('2026-03-05')
  })
  it('addMonthsIso', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 0, 10))
    expect(addMonthsIso(3)).toBe('2026-04-10')
  })
})

describe('useSavingsGoals', () => {
  it('carga metas y pasa a ready', async () => {
    api.fetchGoals.mockResolvedValue([{ id: 1 }])
    const { result } = renderHook(() => useSavingsGoals())
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.goals).toEqual([{ id: 1 }])
  })
  it('error de red -> status error', async () => {
    api.fetchGoals.mockRejectedValue(new Error('x'))
    const { result } = renderHook(() => useSavingsGoals())
    await waitFor(() => expect(result.current.status).toBe('error'))
  })
  it('addGoal normaliza fecha/imagen vacías a null y refresca', async () => {
    api.fetchGoals.mockResolvedValue([])
    const { result } = renderHook(() => useSavingsGoals())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { await result.current.addGoal({ nombre: 'A', objetivo: 5, emoji: '🎯' }) })
    expect(api.createGoal).toHaveBeenCalledWith('A', 5, '🎯', null, null)
    expect(api.fetchGoals).toHaveBeenCalledTimes(2)
  })
})
