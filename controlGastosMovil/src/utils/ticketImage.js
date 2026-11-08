// Prepara la foto de un ticket para mandarla a leer: se reduce y se recomprime en
// JPEG en el móvil (el tope del servidor es ~1 MB). Al pasar por un canvas se pierde
// también la ubicación y demás metadatos EXIF de la foto.
import { compressImage } from '../components/ui/goals/goalUtils'

export const MAX_DATAURL_CHARS = 1_300_000   // < 1.400.000 que admite el servidor
const STEPS = [[1600, 0.8], [1280, 0.7], [1000, 0.6], [800, 0.5]]

export async function prepareTicketImage(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Elige una imagen (foto del ticket).')
  for (const [dim, q] of STEPS) {
    const dataUrl = await compressImage(file, dim, q)
    if (dataUrl.length <= MAX_DATAURL_CHARS) return dataUrl
  }
  throw new Error('La imagen es demasiado grande. Prueba con otra foto.')
}
