// Lógica pura de la recepción de pagos del Atajo de iOS (?atajo=1&importe=…).
import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseImporte, parseIntakeParams, buildIdExterno, captureIntakeFromUrl, cleanIntakeUrl,
  loadIntakeQueue, enqueueIntake, removeIntake, isRetryableError,
} from '../src/utils/shortcutIntake'
import { SHORTCUT_QUEUE_KEY, USER_DATA_KEYS, clearUserData } from '../src/utils/storageKeys'

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('parseImporte (texto tal cual de Cartera)', () => {
  it.each([
    ['12,30 €', 12.3], ['1.234,56 €', 1234.56], ['€12.30', 12.3], ['1,234.56', 1234.56],
    ['-4,50 €', 4.5], ['12', 12], ['1.234 €', 1234], ['0,99 €', 0.99], ['12,3', 12.3],
    ['US$ 7.5', 7.5], [15.2, 15.2],
  ])('%s → %s', (raw, n) => expect(parseImporte(raw)).toBe(n))

  it.each([[''], ['€'], [null], ['abc'], ['0,00 €']])('%s → null', raw => expect(parseImporte(raw)).toBeNull())
})

describe('parseIntakeParams', () => {
  const now = new Date('2026-10-12T10:15:30Z')

  it('ignora URLs que no son del Atajo', () => {
    expect(parseIntakeParams('')).toBeNull()
    expect(parseIntakeParams('?importe=3')).toBeNull()
  })

  it('lee importe, comercio, fecha e id', () => {
    const r = parseIntakeParams('?atajo=1&importe=12%2C30%20%E2%82%AC&comercio=Mercadona%20Centro&fecha=2026-10-11&id=abc', now)
    expect(r).toMatchObject({ importe: 12.3, importeTexto: '12,30 €', comercio: 'Mercadona Centro', fecha: '2026-10-11', fuente: 'wallet', id_externo: 'abc' })
  })

  it('id_externo estable para los mismos parámetros dentro del mismo minuto', () => {
    const a = parseIntakeParams('?atajo=1&importe=5&comercio=Bar', now)
    const b = parseIntakeParams('?atajo=1&importe=5&comercio=Bar', new Date('2026-10-12T10:15:59Z'))
    const c = parseIntakeParams('?atajo=1&importe=5&comercio=Bar', new Date('2026-10-12T10:16:01Z'))
    const d = parseIntakeParams('?atajo=1&importe=6&comercio=Bar', now)
    expect(a.id_externo).toMatch(/^wallet-[0-9a-f]{8}$/)
    expect(a.id_externo).toBe(b.id_externo)
    expect(a.id_externo).not.toBe(c.id_externo)
    expect(a.id_externo).not.toBe(d.id_externo)
    expect(buildIdExterno({ id: 'x1', importeTexto: '5' })).toBe('x1')
  })

  it('fecha inválida se ignora; importe ilegible devuelve error', () => {
    expect(parseIntakeParams('?atajo=1&importe=5&fecha=ayer', now).fecha).toBeNull()
    expect(parseIntakeParams('?atajo=1&importe=hola&comercio=X', now)).toEqual({ error: 'importe', importeTexto: 'hola', comercio: 'X' })
  })
})

describe('captureIntakeFromUrl', () => {
  it('limpia la URL (recargar no repite) y guarda el pago en la cola', () => {
    window.history.replaceState(null, '', '/?tab=mes&atajo=1&importe=3%2C20&comercio=Caf%C3%A9#x')
    const r = captureIntakeFromUrl()
    expect(r.item).toMatchObject({ importe: 3.2, comercio: 'Café' })
    expect(window.location.search).toBe('?tab=mes')
    expect(window.location.hash).toBe('#x')
    expect(loadIntakeQueue()).toHaveLength(1)
    expect(captureIntakeFromUrl()).toBeNull()
    expect(loadIntakeQueue()).toHaveLength(1)
  })

  it('importe ilegible: limpia la URL pero no encola', () => {
    window.history.replaceState(null, '', '/?atajo=1&importe=x')
    expect(captureIntakeFromUrl()).toMatchObject({ error: 'importe' })
    expect(window.location.search).toBe('')
    expect(loadIntakeQueue()).toHaveLength(0)
  })

  it('cleanIntakeUrl deja la ruta limpia', () => {
    window.history.replaceState(null, '', '/?atajo=1&importe=1&comercio=a&fecha=2026-01-01&id=z')
    cleanIntakeUrl()
    expect(window.location.pathname + window.location.search).toBe('/')
  })
})

describe('cola offline', () => {
  it('no duplica por id_externo y se puede quitar', () => {
    enqueueIntake({ id_externo: 'a', importe: 1 })
    enqueueIntake({ id_externo: 'a', importe: 1 })
    enqueueIntake({ id_externo: 'b', importe: 2 })
    expect(loadIntakeQueue().map(x => x.id_externo)).toEqual(['a', 'b'])
    removeIntake('a')
    expect(loadIntakeQueue().map(x => x.id_externo)).toEqual(['b'])
    removeIntake('b')
    expect(localStorage.getItem(SHORTCUT_QUEUE_KEY)).toBeNull()
  })

  it('es dato del usuario: clearUserData la borra', () => {
    expect(USER_DATA_KEYS).toContain('mi-economia-shortcut-queue-v1')
    enqueueIntake({ id_externo: 'a', importe: 1 })
    clearUserData()
    expect(loadIntakeQueue()).toEqual([])
  })

  it('isRetryableError: red, timeout, 5xx y sesión caducada sí; validación no', () => {
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryableError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true)
    expect(isRetryableError(new Error('API 503'))).toBe(true)
    expect(isRetryableError(new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.'))).toBe(true)
    expect(isRetryableError(new Error('importe inválido'))).toBe(false)
    expect(isRetryableError(new Error('API 429'))).toBe(true)
    expect(isRetryableError(new Error('API 422'))).toBe(false)
  })
})
