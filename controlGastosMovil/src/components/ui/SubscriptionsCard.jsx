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
const MAX_CANDIDATES = 40

/* «Suscripciones» dentro de los gastos fijos del mes. SIEMPRE se ve (aunque esté vacía):
   - Las que has marcado, con próxima renovación y coste al mes / al año (si la app ya detecta
     el patrón de repetición) o, si aún no, solo el nombre.
   - «Añadir suscripción»: los gastos que la app detecta que se repiten y, además, cualquier
     categoría que ya uses (Netflix, HBO, Uber…), para marcarla a mano.
   Marcarlas hace que cuenten como gasto fijo (fila «Suscripciones» de Gastos Fijos). */
export default function SubscriptionsCard({ transactions }) {
  const { items, status } = useRecurring()
  const { keys, toggle } = useSubscriptionMarks()
  const hide = useHideAmounts()
  const [adding, setAdding] = useState(false)

  const prep = useMemo(() => prepareTransactions(transactions || [], {}), [transactions])
  const { marked, suggestions } = useMemo(
    () => splitSubscriptions({ recurring: status === 'ready' ? items : [], bucketOf: prep.bucketOf, keys }),
    [items, status, prep, keys],
  )

  const detectedKeys = new Set(marked.items.map(i => i.key))
  const undetected = keys.filter(k => !detectedKeys.has(k)).map(k => ({ key: k, nombre: prep.names.get(k) || k }))
  const suggestedKeys = new Set(suggestions.map(s => s.key))
  const others = [...prep.bucketOf.keys()]
    .filter(k => prep.bucketOf.get(k) !== 'income' && !keys.includes(k) && !suggestedKeys.has(k))
    .map(k => ({ key: k, nombre: prep.names.get(k) || k }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, MAX_CANDIDATES)

  const money = n => fmtAmount(n, hide, 2)
  const hasMarked = marked.items.length > 0 || undetected.length > 0
  return (
    <Card title="🔁 Suscripciones" noPad>
      {marked.items.length > 0 && (
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
      )}
      {undetected.length > 0 && (
        <ul className="sub-list">
          {undetected.map(s => (
            <li key={s.key} className="sub-item">
              <span className="sub-name"><span className="sub-concept">{s.nombre}</span><span className="sub-freq">Aún sin renovación detectada</span></span>
              <button type="button" className="s-action-btn" aria-label={`Quitar ${s.nombre} de suscripciones`} onClick={() => toggle(s.key)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {!hasMarked && (
        <p className="s-note s-note--top">
          Aquí verás tus suscripciones (Netflix, HBO, Uber…) con lo que pagas al mes y la próxima renovación. Marca las que tengas: contarán como gasto fijo.
        </p>
      )}

      <button type="button" className="card-collapse-header" onClick={() => setAdding(v => !v)} aria-expanded={adding}>
        <span className="card-title">Añadir suscripción</span>
        <span className={`card-collapse-arrow${adding ? ' open' : ''}`}>›</span>
      </button>
      {adding && (
        <div>
          {status === 'loading' && <p className="s-note" role="status">Buscando gastos que se repiten…</p>}
          {suggestions.length > 0 && (
            <>
              <p className="s-note s-note--top">Detectados: se repiten con regularidad</p>
              <ul className="sub-list">
                {suggestions.map(s => (
                  <li key={s.key} className="sub-item">
                    <span className="sub-name"><span className="sub-concept">{s.concepto}</span><span className="sub-freq">{s.frecuencia} · {money(s.importe)}</span></span>
                    <button type="button" className="s-action-btn" aria-label={`Marcar ${s.concepto} como suscripción`} onClick={() => toggle(s.key)}>Es suscripción</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {others.length > 0 && (
            <>
              <p className="s-note s-note--top">Otras categorías que ya usas</p>
              <ul className="sub-list">
                {others.map(c => (
                  <li key={c.key} className="sub-item">
                    <span className="sub-name"><span className="sub-concept">{c.nombre}</span></span>
                    <button type="button" className="s-action-btn" aria-label={`Marcar ${c.nombre} como suscripción`} onClick={() => toggle(c.key)}>Es suscripción</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {status !== 'loading' && !suggestions.length && !others.length && (
            <p className="s-note s-note--top">Todavía no hay movimientos con los que elegir. Cuando apuntes gastos (Netflix, HBO…), aparecerán aquí.</p>
          )}
        </div>
      )}
    </Card>
  )
}
