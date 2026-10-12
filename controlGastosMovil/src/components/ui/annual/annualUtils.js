import { fmt } from '../../../utils'
import { createNotifCache } from '../../../utils/notifCache'
import { ANNUAL_NOTIF_KEY } from '../../../utils/storageKeys'

// Utilidades de los gastos fijos anuales (estado, progreso, recordatorio .ics, caché de avisos).

export const notifCache = createNotifCache(ANNUAL_NOTIF_KEY)

// Genera un .ics descargable con un aviso `dias_aviso` días antes del
// vencimiento — lo abre el Calendario de Apple/Google (la web no tiene
// acceso a la app de Recordatorios nativa, pero un evento con alarma
// cumple la misma función de avisar).
function buildIcs(expense) {
  const due = expense.proximo_vencimiento.replace(/-/g, '')
  const uid = `gasto-fijo-${expense.id}-${due}@mieconomia`
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mi Economia//Gastos fijos//ES',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${due}`,
    `DTEND;VALUE=DATE:${due}`,
    `SUMMARY:💶 ${expense.nombre} (${fmt(expense.importe)})`,
    `DESCRIPTION:Vencimiento de ${expense.nombre} — ${fmt(expense.importe)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:Se acerca el pago de ${expense.nombre}`,
    `TRIGGER:-P${expense.dias_aviso}D`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}

// Cuánto del reparto ya ha caído en un mes pasado (o el actual) — para que se
// vea que la anualidad se va "pagando" a medida que pasan esos meses, igual
// que ya se descuenta del saldo de cada mes en Mes/Stats/Año.
export function annualProgress(expense) {
  if (!expense.meses_reparto?.length) return null
  const mesActual = new Date().getMonth() + 1
  const pasados = expense.meses_reparto.filter(m => m <= mesActual).length
  const pagado = Math.round(pasados * expense.reparto_mensual * 100) / 100
  return { pasados, total: expense.meses_reparto.length, pagado, pendiente: Math.round((expense.importe - pagado) * 100) / 100 }
}

// Estado según el vencimiento: color + icono + texto
export function dueState(exp) {
  const d = exp.dias_restantes
  if (d < 0)  return { key: 'overdue', icon: '✕', label: `Vencido hace ${-d} día${d !== -1 ? 's' : ''}` }
  if (d === 0) return { key: 'soon',   icon: '!', label: 'Vence hoy' }
  if (exp.aviso_activo || d <= 30)
              return { key: 'soon',   icon: '!', label: `En ${d} día${d !== 1 ? 's' : ''}` }
  return        { key: 'far',    icon: '✓', label: `En ${d} días` }
}

export function downloadIcs(expense) {
  const blob = new Blob([buildIcs(expense)], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), {
    href: url, download: `${expense.nombre.replace(/[^\w-]/g, '_')}.ics`,
  })
  a.click()
  URL.revokeObjectURL(url)
}
