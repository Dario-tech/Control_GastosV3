// Servicios de suscripción conocidos (con logo) para la categoría «Suscripciones».
// Los logos son de `simple-icons` (formas de marca); los que ya no incluye ese paquete
// (Disney+, Prime Video…) usan una ficha con su inicial y el color de la marca.
import {
  siNetflix, siHbomax, siSpotify, siYoutube, siApplemusic, siAppletv, siUber, siDazn, siTwitch,
  siCrunchyroll, siParamountplus, siIcloud, siAudible, siDeezer, siPlaystation,
} from 'simple-icons'
import { normalizeCategoryName } from './categories'

export const SERVICES = [
  { id: 'netflix',   nombre: 'Netflix',       icon: siNetflix },
  { id: 'hbo',       nombre: 'HBO Max',       icon: siHbomax, color: '#5822B4', alias: ['hbo', 'max'] },
  { id: 'disney',    nombre: 'Disney+',       color: '#113CCF', alias: ['disney', 'disney plus'] },
  { id: 'prime',     nombre: 'Prime Video',   color: '#00A8E1', alias: ['prime', 'amazon prime', 'amazon'] },
  { id: 'spotify',   nombre: 'Spotify',       icon: siSpotify },
  { id: 'youtube',   nombre: 'YouTube',       icon: siYoutube, alias: ['youtube premium'] },
  { id: 'applemusic', nombre: 'Apple Music',  icon: siApplemusic },
  { id: 'appletv',   nombre: 'Apple TV+',     icon: siAppletv, alias: ['apple tv'] },
  { id: 'dazn',      nombre: 'DAZN',          icon: siDazn, color: '#0C0C0C' },
  { id: 'movistar',  nombre: 'Movistar+',     color: '#019DF4', alias: ['movistar plus', 'movistar'] },
  { id: 'filmin',    nombre: 'Filmin',        color: '#E6007E' },
  { id: 'crunchyroll', nombre: 'Crunchyroll', icon: siCrunchyroll },
  { id: 'paramount', nombre: 'Paramount+',    icon: siParamountplus, alias: ['paramount'] },
  { id: 'twitch',    nombre: 'Twitch',        icon: siTwitch },
  { id: 'icloud',    nombre: 'iCloud',        icon: siIcloud },
  { id: 'audible',   nombre: 'Audible',       icon: siAudible },
  { id: 'deezer',    nombre: 'Deezer',        icon: siDeezer },
  { id: 'playstation', nombre: 'PlayStation Plus', icon: siPlaystation, alias: ['ps plus', 'psn', 'playstation'] },
  { id: 'xbox',      nombre: 'Xbox Game Pass', color: '#107C10', alias: ['game pass', 'xbox'] },
  { id: 'uber',      nombre: 'Uber One',      icon: siUber, color: '#000000', alias: ['uber'] },
]

const SEP = ' · '

/** ¿Es la categoría «Suscripciones» (o «Suscripción»)? */
export function isSubscriptionCategory(concepto) {
  const n = normalizeCategoryName(concepto)
  return n === 'suscripciones' || n === 'suscripcion'
}

/** Servicio conocido que corresponde a un nombre (o null). */
export function findService(nombre) {
  const n = normalizeCategoryName(nombre)
  if (!n) return null
  return SERVICES.find(s => normalizeCategoryName(s.nombre) === n || (s.alias || []).some(a => normalizeCategoryName(a) === n)) || null
}

/** Nota del movimiento: «Netflix» o «Netflix · nota del usuario». */
export function composeNote(servicio, nota) {
  const s = (servicio || '').trim()
  const t = (nota || '').trim()
  if (!s) return t
  return t ? `${s}${SEP}${t}` : s
}

/** Nombre del servicio de un movimiento de Suscripciones: lo que hay antes de « · » en la nota. */
export function serviceNameOf(comentario) {
  const c = (comentario || '').trim()
  return c ? c.split(SEP)[0].trim() : ''
}

/**
 * Agrupa movimientos de Suscripciones por servicio: [{ nombre, service, total, count }] de
 * mayor a menor total; los que no tienen nombre van juntos al final como «Sin especificar».
 */
export function groupByService(rows) {
  const map = new Map()
  for (const t of rows) {
    const nombre = serviceNameOf(t.comentario)
    const svc = findService(nombre)
    const key = svc ? svc.id : (normalizeCategoryName(nombre) || '')
    const cur = map.get(key) || { nombre: svc ? svc.nombre : (nombre || 'Sin especificar'), service: svc, total: 0, count: 0, unnamed: !nombre }
    cur.total += Math.abs(Number(t.importe) || 0)
    cur.count += 1
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => (a.unnamed - b.unnamed) || b.total - a.total)
}
