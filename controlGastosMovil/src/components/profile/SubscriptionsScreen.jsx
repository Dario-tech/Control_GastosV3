import { useMemo } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useRecurring } from '../../hooks/useRecurring'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { fmtAmount } from '../../utils/amounts'
import { buildSubscriptionCalendar, renewalText } from '../../utils/subscriptions'
import { prepareTransactions } from '../../utils/stats'
import { Section } from './ui'

const DATE_FMT = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtDate = iso => DATE_FMT.format(new Date(iso + 'T12:00:00'))

/* Suscripciones detectadas (gastos que se repiten) con el coste mensual/anual y la
   próxima renovación de cada una. Solo lectura: se calcula con /api/recurring. */
export default function SubscriptionsScreen() {
  const { data } = useFinanceData()
  const { items: recurring, status } = useRecurring()
  const hide = useHideAmounts()

  const cal = useMemo(() => {
    const bucketOf = prepareTransactions(data?.transactions || [], {}).bucketOf
    return buildSubscriptionCalendar({ recurring, bucketOf })
  }, [recurring, data])

  if (status === 'loading') return <p className="s-note s-note--top" role="status">Buscando suscripciones…</p>
  if (status === 'error') return <p className="s-note s-note--error" role="alert">No se pudieron cargar las suscripciones. Inténtalo de nuevo en unos segundos.</p>

  return (
    <>
      <Section title="Coste">
        <div className="sub-totals">
          <div className="sub-total">
            <span className="sub-total-label">Al mes</span>
            <strong className="sub-total-value">{fmtAmount(cal.totalMensual, hide, 2)}</strong>
          </div>
          <div className="sub-total">
            <span className="sub-total-label">Al año</span>
            <strong className="sub-total-value">{fmtAmount(cal.totalAnual, hide, 2)}</strong>
          </div>
        </div>
      </Section>

      <Section title="Próximas renovaciones">
        {cal.items.length === 0 ? (
          <p className="s-note s-note--top">Aún no he detectado suscripciones. Aparecen cuando un mismo gasto se repite al menos 3 veces con el mismo importe y a intervalos regulares.</p>
        ) : (
          <ul className="sub-list">
            {cal.items.map(s => (
              <li key={`${s.concepto}|${s.importe}`} className="sub-item">
                <span className="sub-date">
                  <span className="sub-date-day">{fmtDate(s.fecha)}</span>
                  <span className="sub-date-rel">{renewalText(s.dias)}</span>
                </span>
                <span className="sub-name">
                  <span className="sub-concept">{s.concepto}</span>
                  <span className="sub-freq">{s.frecuencia}{s.frecuencia !== 'mensual' ? ` · ${fmtAmount(s.mensual, hide, 2)}/mes` : ''}</span>
                </span>
                <span className="sub-amount">{fmtAmount(s.importe, hide, 2)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="s-note">Detectadas automáticamente en tu historial; la fecha es una estimación según el último cargo.</p>
      </Section>
    </>
  )
}
