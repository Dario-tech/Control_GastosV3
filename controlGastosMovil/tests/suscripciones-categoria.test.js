import { describe, it, expect } from 'vitest'
import { SERVICES, isSubscriptionCategory, findService, composeNote, serviceNameOf, groupByService } from '../src/data/services'
import { DEFAULT_CATEGORIES } from '../src/data/categories'

describe('Suscripciones: categoría y servicios', () => {
  it('«Suscripciones» es una categoría de Gasto Fijo (y ya no de Variable)', () => {
    expect(DEFAULT_CATEGORIES['Gasto Fijo'].some(c => c.concepto === 'Suscripciones')).toBe(true)
    expect(DEFAULT_CATEGORIES['Gasto Variable'].some(c => c.concepto === 'Suscripciones')).toBe(false)
  })
  it('reconoce la categoría (singular, plural, acentos y mayúsculas)', () => {
    for (const c of ['Suscripciones', 'suscripción', ' SUSCRIPCION ']) expect(isSubscriptionCategory(c)).toBe(true)
    expect(isSubscriptionCategory('Ocio')).toBe(false)
  })
  it('cada servicio tiene nombre único y color o logo', () => {
    expect(new Set(SERVICES.map(s => s.id)).size).toBe(SERVICES.length)
    expect(SERVICES.every(s => s.nombre && (s.color || s.icon))).toBe(true)
    expect(findService('netflix').id).toBe('netflix')
    expect(findService('HBO').nombre).toBe('HBO Max')
    expect(findService('amazon prime').id).toBe('prime')
    expect(findService('Mi gimnasio')).toBeNull()
  })
  it('compone la nota y recupera el servicio', () => {
    expect(composeNote('Netflix', '')).toBe('Netflix')
    expect(composeNote('Netflix', 'plan familiar')).toBe('Netflix · plan familiar')
    expect(composeNote('', 'solo nota')).toBe('solo nota')
    expect(serviceNameOf('Netflix · plan familiar')).toBe('Netflix')
    expect(serviceNameOf('')).toBe('')
  })
  it('agrupa por servicio: mayor total primero y «Sin especificar» al final', () => {
    const rows = [
      { comentario: 'Netflix', importe: 12 }, { comentario: 'hbo', importe: 10 }, { comentario: 'HBO Max · extra', importe: 10 },
      { comentario: '', importe: 50 }, { comentario: 'Gimnasio del barrio', importe: 30 },
    ]
    const g = groupByService(rows)
    expect(g.map(x => [x.nombre, x.total, x.count])).toEqual([
      ['Gimnasio del barrio', 30, 1], ['HBO Max', 20, 2], ['Netflix', 12, 1], ['Sin especificar', 50, 1]])
    expect(g.at(-1).unnamed).toBe(true)
  })
})
