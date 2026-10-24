import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  classifyTxError, txErrorMessage, enqueueTx, loadTxQueue, removeTx, flushTxQueue,
  MSG_OFFLINE, MSG_SESSION, MSG_REJECTED,
} from '../src/utils/txQueue'
import { postTransaction, BASE, CLIENT_ID_FIELD } from '../src/services/api'
import { TX_QUEUE_KEY, clearUserData } from '../src/utils/storageKeys'

const item = (id, extra = {}) => ({ id, importe: 12.5, tipo: 'Gasto Variable', concepto: 'Comida', fecha: '2026-10-24', comentario: null, ...extra })
const netErr = () => Object.assign(new TypeError('Failed to fetch'))
const httpErr = status => Object.assign(new Error(`API ${status}`), { status })

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('classifyTxError / mensajes', () => {
  it('distingue sin conexión, rechazado y sesión caducada', () => {
    expect(classifyTxError(netErr())).toBe('offline')
    expect(classifyTxError(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe('offline')
    expect(classifyTxError(httpErr(503))).toBe('offline')
    expect(classifyTxError(httpErr(422))).toBe('rejected')
    expect(classifyTxError(httpErr(401))).toBe('session')
    expect(classifyTxError(new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.'))).toBe('session')
    expect(txErrorMessage(netErr())).toBe(MSG_OFFLINE)
    expect(txErrorMessage(httpErr(422))).toBe(MSG_REJECTED)
    expect(txErrorMessage(httpErr(401))).toBe(MSG_SESSION)
    expect(txErrorMessage(Object.assign(new Error('Importe demasiado grande'), { status: 422 }))).toContain('Importe demasiado grande')
  })
})

describe('cola', () => {
  it('encola sin duplicar por id y se borra al cerrar sesión', () => {
    enqueueTx(item('a')); enqueueTx(item('a')); enqueueTx(item('b'))
    expect(loadTxQueue().map(x => x.id)).toEqual(['a', 'b'])
    removeTx('a')
    expect(loadTxQueue().map(x => x.id)).toEqual(['b'])
    clearUserData()
    expect(localStorage.getItem(TX_QUEUE_KEY)).toBeNull()
  })

  it('flush: envía con el mismo id y vacía la cola', async () => {
    enqueueTx(item('a')); enqueueTx(item('b'))
    const send = vi.fn().mockResolvedValue({})
    const r = await flushTxQueue({ send })
    expect(r).toEqual({ sent: 2, dropped: 0, pending: 0 })
    expect(send.mock.calls.map(c => c[5])).toEqual(['a', 'b'])
    expect(loadTxQueue()).toEqual([])
  })

  it('flush: si falla la red se detiene y conserva todo con el mismo id; luego reintenta', async () => {
    enqueueTx(item('a')); enqueueTx(item('b'))
    const down = vi.fn().mockRejectedValue(netErr())
    expect(await flushTxQueue({ send: down })).toEqual({ sent: 0, dropped: 0, pending: 2 })
    expect(down).toHaveBeenCalledTimes(1)
    const up = vi.fn().mockResolvedValue({})
    expect((await flushTxQueue({ send: up })).sent).toBe(2)
    expect(up.mock.calls[0][5]).toBe('a')
  })

  it('flush: 4xx se descarta y sigue; 401 conserva y se detiene', async () => {
    enqueueTx(item('bad')); enqueueTx(item('ok'))
    const send = vi.fn().mockRejectedValueOnce(httpErr(422)).mockResolvedValueOnce({})
    expect(await flushTxQueue({ send })).toEqual({ sent: 1, dropped: 1, pending: 0 })
    enqueueTx(item('x'))
    const r = await flushTxQueue({ send: vi.fn().mockRejectedValue(httpErr(401)) })
    expect(r.pending).toBe(1)
  })

  it('no lanza dos envíos en paralelo', async () => {
    enqueueTx(item('a'))
    let release
    const send = vi.fn(() => new Promise(res => { release = res }))
    const p1 = flushTxQueue({ send })
    const r2 = await flushTxQueue({ send })
    expect(r2.sent).toBe(0)
    release({}); await p1
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('postTransaction', () => {
  it('envía el id de cliente con el nombre de CLIENT_ID_FIELD', async () => {
    const f = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    vi.stubGlobal('fetch', f)
    await postTransaction(5, 'Gasto Variable', 'Comida', '2026-10-24', null, 'uuid-1')
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe(`${BASE}/api/transaction`)
    expect(JSON.parse(opts.body)[CLIENT_ID_FIELD]).toBe('uuid-1')
    await postTransaction(5, 'Gasto Variable', 'Comida')
    expect(CLIENT_ID_FIELD in JSON.parse(f.mock.calls[1][1].body)).toBe(false)
  })
})
