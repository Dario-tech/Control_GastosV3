import { describe, it, expect, vi } from 'vitest'

const compress = vi.hoisted(() => vi.fn())
vi.mock('../src/components/ui/goals/goalUtils', () => ({ compressImage: compress }))
import { prepareTicketImage, MAX_DATAURL_CHARS } from '../src/utils/ticketImage'

const file = type => new File(['x'], 'f', { type })

describe('prepareTicketImage', () => {
  it('rechaza lo que no es imagen', async () => {
    await expect(prepareTicketImage(file('application/pdf'))).rejects.toThrow(/imagen/)
    expect(compress).not.toHaveBeenCalled()
  })
  it('reduce la calidad hasta que cabe en el límite del servidor', async () => {
    compress.mockReset()
    compress.mockResolvedValueOnce('a'.repeat(MAX_DATAURL_CHARS + 1)).mockResolvedValueOnce('b'.repeat(1000))
    expect(await prepareTicketImage(file('image/jpeg'))).toBe('b'.repeat(1000))
    expect(compress.mock.calls.map(c => c[1])).toEqual([1600, 1280])
  })
  it('falla si nada cabe', async () => {
    compress.mockReset()
    compress.mockResolvedValue('a'.repeat(MAX_DATAURL_CHARS + 1))
    await expect(prepareTicketImage(file('image/png'))).rejects.toThrow(/demasiado grande/)
  })
})
