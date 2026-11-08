import { useMemo, useState } from 'react'
import Card from './Card'
import { useRecurring } from '../../hooks/useRecurring'
import { useSubscriptionMarks } from '../../hooks/useSubscriptionMarks'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { fmtAmount } from '../../utils/amounts'
import { splitSubscriptions, renewalText } from '../../utils/subscriptions'
import { prepareTransactions } from '../../utils/stats'

const DATE_FMT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
const fmtDate = iso => DATE_FMT.format(new Date(iso + 'T12:00:00'))

/* «Suscripciones» dentro de los gastos fijos del mes: lo que has marcado (con su próxima
   renovación y el coste mensual/anual) y, aparte, los gastos que se repiten y la app
   sugiere por si quieres marcarlos. Solo lectura salvo marcar/desmarcar. */
export default function SubscriptionsCard({ transactions }) {
  const { items, status } = useRecurring()
  const { keys, toggle } = useSubscriptionMarks()
  const hide = useHideAmounts()
  const [showSuggestions, setShowSuggestions] = useState(false)

  const { marked, suggestions } = useMemo(() => {
    const bucketOf = prepareTransactions(transactions || [], {}).bucketOf
    return splitSubscriptions({ recurring: items, bucketOf, keys })
  }, [items, transactions, keys])

  if (status === 'loading') return null
  if (status === 'error' || (!marked.items.length && !suggestions.length)) return null

  const money = n => fmtAmount(n, hide, 2)
  return (
    <Card title="🔁 Suscripciones" noPad>
      {marked.items.length > 0 ? (
        <>
          <div className="sub-totals">
            <div className="sub-total"><span className="sub-total-label">Al mes</span><strong className="sub-total-value">{money(marked.totalMensual)}</strong></div>
            <div className="sub-total"><span className="sub-total-label">Al año</span><strong className="sub-total-value">{money(marked.totalAnual)}</strong></div>
          </div>
          <ul className="sub-list">
            {marked.items.map(s => (
              <li key={s.key} className="sub-item">
                <span className="sub-date"><span className="sub-date-day">{fmtDate(s.fecha)}</span><span className="sub-date-rel">{renewalText(s.dias)}</span></span>
                <span className="sub-name"><span className="sub-concept">{s.concepto}</span><span className="sub-freq">{s.frecuencia}</span></span>
                <span className="sub-amount">{money(s.importe)}</span>
                <button type="button" className="s-action-btn" aria-label={`Quitar ${s.concepto} de suscripciones`} onClick={() => toggle(s.key)}>✕</button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="s-note s-note--top">Aún no has marcado ninguna. Marca los gastos que se repiten y son suscripciones (Netflix, HBO…) y contarán como gasto fijo.</p>
      )}
      {suggestions.length > 0 && (
        <>
          <button type="button" className="card-collapse-header" onClick={() => setShowSuggestions(v => !v)} aria-expanded={showSuggestions}>
            <span className="card-title">Detectados que se repiten ({suggestions.length})</span>
            <span className={`card-collapse-arrow${showSuggestions ? ' open' : ''}`}>›</span>
          </button>
          {showSuggestions && (
            <ul className="sub-list">
              {suggestions.map(s => (
                <li key={s.key} className="sub-item">
                  <span className="sub-name"><span className="sub-concept">{s.concepto}</span><span className="sub-freq">{s.frecuencia} · {money(s.importe)}</span></span>
                  <button type="button" className="s-action-btn" aria-label={`Marcar ${s.concepto} como suscripción`} onClick={() => toggle(s.key)}>Es suscripción</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}
