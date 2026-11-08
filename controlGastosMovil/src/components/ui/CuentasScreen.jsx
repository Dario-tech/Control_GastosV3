import { useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { fmtAmount } from '../../utils/amounts'
import { parseAmountInput } from '../../utils/groups'
import { todayLocal } from '../../utils'
import {
  addSharedPerson, deleteSharedPerson, addSharedSettlement, deleteSharedSettlement, deleteSharedExpense,
} from '../../services/api'
import { FormScreen, Field, Section, Icon } from './FormKit'

/* «Cuentas»: con quién tienes dinero pendiente. Saldo > 0 = te debe; < 0 = le debes.
   Liquidar (cobro/pago) NO crea ingreso ni gasto: solo cierra la deuda. */
export default function CuentasScreen({ shared, onClose }) {
  const { state, apply, reload, loading, error } = shared
  const { transactions } = useFinanceData()
  const hide = useHideAmounts()
  const money = n => fmtAmount(Math.abs(n), hide)
  const [openId, setOpenId] = useState(null)
  const [nuevo, setNuevo]   = useState('')
  const [importe, setImporte] = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')

  const persona = state.personas.find(p => p.id === openId)
  const concepto = g => transactions.find(t => t.rowIndex === g.transaction_id)?.concepto ?? 'Gasto compartido'
  const nombreDe = k => (k === 'yo' ? 'Yo' : state.personas.find(p => p.clave === k)?.nombre ?? '?')

  async function run(fn) {
    if (busy) return
    setBusy(true); setErr('')
    try { apply(await fn()) } catch (e) { setErr(e.message); reload() } finally { setBusy(false) }
  }

  const crear = e => {
    e.preventDefault()
    const n = nuevo.trim()
    if (n) run(async () => { const st = await addSharedPerson(n); setNuevo(''); return st })
  }

  function liquidar(direccion) {
    const v = parseAmountInput(importe) ?? (persona ? Math.abs(persona.saldo) : null)
    if (!v) { setErr('Escribe un importe válido'); return }
    run(async () => {
      const st = await addSharedSettlement({ persona_id: persona.id, direccion, importe: v, fecha: todayLocal() })
      setImporte('')
      return st
    })
  }

  const frase = p => p.saldo > 0 ? `Te debe ${money(p.saldo)}` : p.saldo < 0 ? `Le debes ${money(p.saldo)}` : 'Al día'
  const clase = p => p.saldo > 0 ? 'grp-pos' : p.saldo < 0 ? 'grp-neg' : ''

  if (persona) {
    const gastos = state.gastos.filter(g => g.partes[persona.clave] != null || g.pagado_por === persona.clave)
    const pagos = state.pagos.filter(p => p.de === persona.clave || p.a === persona.clave)
    return (
      <FormScreen title={persona.nombre} subtitle={frase(persona)} onClose={() => { setOpenId(null); setErr('') }}>
        <Section title="Liquidar">
          <div className="grp-add">
            <Field label={`Importe (vacío = ${money(persona.saldo)})`}>
              {({ id }) => (
                <input id={id} className="fm-input" inputMode="decimal" placeholder="0,00" value={importe}
                  onChange={e => setImporte(e.target.value)} />
              )}
            </Field>
            <div className="grp-actions">
              <button type="button" className="s-action-btn s-touch" disabled={busy} onClick={() => liquidar('cobro')}>Me ha pagado</button>
              <button type="button" className="s-action-btn s-touch" disabled={busy} onClick={() => liquidar('pago')}>Le he pagado</button>
            </div>
            <p className="s-note">No cuenta como ingreso ni gasto: solo cierra la deuda.</p>
          </div>
        </Section>
        <Section title="Gastos">
          {gastos.length === 0 && <p className="s-note s-note--top">Sin gastos compartidos.</p>}
          <ul className="grp-balances">
            {gastos.map(g => (
              <li key={g.id}>
                <span>{g.fecha} · {concepto(g)}{g.etiqueta ? ` · ${g.etiqueta}` : ''} · pagó {nombreDe(g.pagado_por)}</span>
                <span>{money(g.importe)} <button type="button" className="s-link" disabled={busy} aria-label="Quitar reparto y movimiento"
                  onClick={() => run(() => deleteSharedExpense(g.id))}><Icon name="close" size={14} /></button></span>
              </li>
            ))}
          </ul>
        </Section>
        {pagos.length > 0 && (
          <Section title="Liquidaciones">
            <ul className="grp-balances">
              {pagos.map(p => (
                <li key={p.id}>
                  <span>{p.fecha} · {p.de === 'yo' ? 'Le pagaste' : 'Te pagó'}</span>
                  <span>{money(p.importe)} <button type="button" className="s-link" disabled={busy} aria-label="Quitar liquidación"
                    onClick={() => run(() => deleteSharedSettlement(p.id))}><Icon name="close" size={14} /></button></span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {gastos.length === 0 && pagos.length === 0 && (
          <button type="button" className="s-action-btn s-touch" disabled={busy}
            onClick={() => run(async () => { const st = await deleteSharedPerson(persona.id); setOpenId(null); return st })}>
            Eliminar a {persona.nombre}
          </button>
        )}
        {err && <p className="fm-error" role="alert">{err}</p>}
      </FormScreen>
    )
  }

  return (
    <FormScreen title="Cuentas" subtitle="Con quién tienes dinero pendiente" onClose={onClose}>
      <Section title="Personas">
        {loading && <p className="s-note s-note--top" role="status">Cargando…</p>}
        {!loading && state.personas.length === 0 && (
          <p className="s-note s-note--top">Aún no hay nadie. Al añadir un gasto, activa «Dividir con otras personas» o añade a alguien aquí.</p>
        )}
        {state.personas.map((p, i) => (
          <button key={p.id} type="button" className={`pf-row pf-nav-row${i === state.personas.length - 1 ? ' last' : ''}`} onClick={() => { setOpenId(p.id); setErr('') }}>
            <span className="pf-row-left"><span className="pf-row-icon" aria-hidden="true">👤</span><span className="pf-row-label">{p.nombre}</span></span>
            <span className="pf-row-right"><span className={`pf-row-value ${clase(p)}`}>{frase(p)}</span></span>
          </button>
        ))}
      </Section>
      <Section title="Añadir persona">
        <form className="grp-form" onSubmit={crear}>
          <input className="fm-input" value={nuevo} onChange={e => setNuevo(e.target.value)} maxLength={60}
            placeholder="Nombre" aria-label="Nombre de la persona" autoComplete="off" />
          <button type="submit" className="s-action-btn s-touch" disabled={busy || !nuevo.trim()}>Añadir</button>
        </form>
      </Section>
      {(err || error) && <p className="fm-error" role="alert">{err || error}</p>}
    </FormScreen>
  )
}
