import { useState } from 'react'
import { useFixedRecurring } from '../../hooks/useFixedRecurring'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { fmtAmount } from '../../utils/amounts'
import { MONTH_NAMES } from '../../data/mockData'
import { ConfirmSheet } from './FormKit'

const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}` }

/* Gastos fijos que se repiten cada mes (el piso…). Se dan de alta al apuntar un gasto fijo
   con «Repetir cada mes»; aquí se ve hasta cuándo duran y se puede cambiar la fecha de fin
   o pararlos. Se proyectan como previstos en Mes y Año; no crean movimientos reales. */
export default function FixedRecurring() {
  const { rules, status, editRule, removeRule } = useFixedRecurring()
  const hide = useHideAmounts()
  const [editing, setEditing] = useState(null)   // { rule, hasta, sinFin }
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')

  if (status === 'loading' || (status === 'error' && !rules.length)) return null
  if (!rules.length) {
    return (
      <section className="card" aria-labelledby="fr-title">
        <h2 id="fr-title" className="card-title">🔁 Fijos que se repiten</h2>
        <p className="s-note">Al apuntar un Gasto Fijo (el piso…) activa «Repetir cada mes» e indica hasta cuándo: aparecerá solo en los meses siguientes.</p>
      </section>
    )
  }

  async function save() {
    const { rule, hasta, sinFin } = editing
    setError('')
    try {
      await editRule(rule.id, { concepto: rule.concepto, importe: rule.importe, dia: rule.dia, desde: rule.desde, hasta: sinFin ? null : hasta })
      setEditing(null)
    } catch (e) { setError(e.message || 'No se pudo guardar.') }
  }

  return (
    <section className="card" aria-labelledby="fr-title">
      <h2 id="fr-title" className="card-title">🔁 Fijos que se repiten</h2>
      <ul className="sub-list">
        {rules.map(r => (
          <li key={r.id} className="sub-item">
            <span className="sub-name">
              <span className="sub-concept">{r.concepto}</span>
              <span className="sub-freq">{r.hasta ? `Hasta ${monthLabel(r.hasta)}` : 'Sin fecha de fin'} · desde {monthLabel(r.desde)}</span>
            </span>
            <span className="sub-amount">{fmtAmount(r.importe, hide, 2)}</span>
            <button type="button" className="s-action-btn" aria-label={`Cambiar fecha de fin de ${r.concepto}`}
              onClick={() => { setError(''); setEditing({ rule: r, hasta: r.hasta || r.desde, sinFin: !r.hasta }) }}>Fin</button>
            <button type="button" className="s-action-btn" aria-label={`Dejar de repetir ${r.concepto}`} onClick={() => setConfirm(r)}>✕</button>
          </li>
        ))}
      </ul>
      {editing && (
        <div className="grp-add">
          <p className="grp-label">{editing.rule.concepto}: ¿hasta cuándo?</p>
          <label><input type="checkbox" checked={editing.sinFin} onChange={e => setEditing({ ...editing, sinFin: e.target.checked })} /> Sin fecha de fin</label>
          {!editing.sinFin && (
            <input className="fm-input" type="month" aria-label="Último mes" min={editing.rule.desde} value={editing.hasta}
              onChange={e => setEditing({ ...editing, hasta: e.target.value })} />
          )}
          {error && <p className="s-note s-note--error" role="alert">{error}</p>}
          <div className="grp-actions">
            <button type="button" className="s-action-btn s-touch" onClick={() => setEditing(null)}>Cancelar</button>
            <button type="button" className="s-action-btn s-touch" onClick={save}>Guardar</button>
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmSheet title="¿Dejar de repetir?" confirmLabel="Dejar de repetir"
          message={`«${confirm.concepto}» dejará de aparecer como previsto en los meses siguientes. Los movimientos ya apuntados no se tocan.`}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { try { await removeRule(confirm.id) } finally { setConfirm(null) } }} />
      )}
    </section>
  )
}
