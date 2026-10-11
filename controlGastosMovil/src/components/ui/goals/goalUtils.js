// Utilidades compartidas por las metas de ahorro (tarjetas, formulario y detalle).

export function formatContribDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}

// Redimensiona y comprime la foto en el cliente antes de subirla: las fotos
// se guardan en la base de datos (sin object storage), así que el tamaño importa.
export async function compressImage(file, maxDim = 800, quality = 0.72) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload  = () => resolve(i)
      i.onerror = () => reject(new Error('No se pudo leer la imagen'))
      i.src = url
    })
    const scale  = Math.min(1, maxDim / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width  = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Texto de apoyo: cuánto falta y, si hay fecha futura, cuánto aportar al mes.
export function goalRemaining(goal) {
  const falta = Math.max(0, goal.objetivo - goal.ahorrado)
  let mes = null
  if (falta > 0 && goal.fecha) {
    const d = new Date(goal.fecha)
    if (!isNaN(d)) {
      const now = new Date()
      const months = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
      if (months > 0) mes = falta / months
    }
  }
  return { falta, mes }
}

export function formatGoalDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })
  } catch { return iso }
}

// Fecha local en formato YYYY-MM-DD (sin pasar por UTC, que desplaza el día).
export function toIso(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function addMonthsIso(n) {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return toIso(d)
}
