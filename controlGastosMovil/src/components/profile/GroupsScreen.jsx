import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useApp } from '../../context/AppContext'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { fmtAmount } from '../../utils/amounts'
import { parseAmountInput, equalSplit, splitDifference, debtText } from '../../utils/groups'
import {
  fetchGroups, fetchGroup, createGroup, deleteGroup, inviteToGroup,
  addGroupExpense, deleteGroupExpense, addGroupSettlement, deleteGroupSettlement,
} from '../../services/api'
import { Section, Row, Segmented } from './ui'

const MODES = [{ value: 'igual', label: 'A partes iguales', name: 'A partes iguales' }, { value: 'importes', label: 'Por importes', name: 'Por importes' }]

/* Gastos compartidos: lista de grupos y, dentro de uno, saldos, gastos, pagos e invitaciones.
   El servidor calcula los saldos; aquí solo se muestran. */
export default function GroupsScreen() {
  const [groups, setGroups] = useState(null)   // null = cargando
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setGroups(await fetchGroups()); setError('') } catch (e) { setError(e.message || 'No se pudieron cargar los grupos.') ; setGroups(g => g ?? []) }
  }, [])
  useEffect(() => { load() }, [load])

  async function onCreate(e) {
    e.preventDefault()
    if (!nombre.trim() || busy) return
    setBusy(true); setError('')
    try {
      const g = await createGroup(nombre.trim())
      setNombre(''); await load(); setOpenId(g.id)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (openId != null) {
    return <GroupDetail id={openId} onBack={() => { setOpenId(null); load() }} />
  }
  return (
    <>
      <Section title="Mis grupos">
        {groups === null && <p className="s-note s-note--top" role="status">Cargando…</p>}
        {groups?.length === 0 && <p className="s-note s-note--top">Aún no tienes grupos. Crea uno para repartir gastos con otras personas que ya usen Mi Economía.</p>}
        {groups?.map((g, i) => (
          <button key={g.id} type="button" className={`pf-row pf-nav-row${i === groups.length - 1 ? ' last' : ''}`} onClick={() => setOpenId(g.id)}>
            <span className="pf-row-left"><span className="pf-row-icon" aria-hidden="true">👥</span><span className="pf-row-label">{g.nombre}</span></span>
            <span className="pf-row-right"><span className="pf-row-value">{g.miembros.length} personas</span></span>
          </button>
        ))}
      </Section>
      <Section title="Nuevo grupo">
        <form className="grp-form" onSubmit={onCreate}>
          <input className="fm-input" value={nombre} onChange={e => setNombre(e.target.value)} maxLength={60} placeholder="Ej.: Viaje a Roma" aria-label="Nombre del grupo" />
          <button type="submit" className="s-action-btn s-touch" disabled={busy || !nombre.trim()}>Crear</button>
        </form>
      </Section>
      {error && <p className="s-note s-note--error" role="alert">{error}</p>}
    </>
  )
}

function GroupDetail({ id, onBack }) {
  const { user } = useAuth()
  const { showToast } = useApp()
  const hide = useHideAmounts()
  const me = user?.email
  const [g, setG] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [form, setForm] = useState(false)

  useEffect(() => {
    let alive = true
    fetchGroup(id).then(d => { if (alive) setG(d) }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [id])

  const money = n => fmtAmount(n, hide, 2)
  const nameOf = e => g?.miembros.find(m => m.email === e)?.nombre || e

  // Toda escritura devuelve el grupo ya recalculado (o falla con un mensaje).
  async function act(fn, okMsg) {
    if (busy) return false
    setBusy(true); setError('')
    try {
      const res = await fn()
      if (res && res.id === id) setG(res)
      if (okMsg) showToast(okMsg)
      return true
    } catch (e) { setError(e.message || 'No se pudo completar la acción.'); return false } finally { setBusy(false) }
  }

  async function onDeleteGroup() {
    if (!window.confirm('¿Borrar el grupo y todos sus gastos para todos los miembros?')) return
    if (await act(() => deleteGroup(id), 'Grupo borrado')) onBack()
  }

  if (!g) {
    return (
      <>
        <button type="button" className="s-action-btn s-touch" onClick={onBack}>← Grupos</button>
        {error ? <p className="s-note s-note--error" role="alert">{error}</p> : <p className="s-note" role="status">Cargando…</p>}
      </>
    )
  }
  const soyCreador = g.creado_por === me

  return (
    <>
      <div className="grp-head">
        <button type="button" className="s-action-btn s-touch" onClick={onBack}>← Grupos</button>
        <h2 className="grp-title">{g.nombre}</h2>
      </div>
      {error && <p className="s-note s-note--error" role="alert">{error}</p>}
      {g.sin_leer > 0 && <p className="s-note s-note--error">{g.sin_leer} registros no se pudieron leer en el servidor y no cuentan en los saldos.</p>}

      <Section title="Quién debe a quién">
        {g.deudas.length === 0 ? <p className="s-note s-note--top">Todo saldado 🎉</p> : g.deudas.map((d, i) => (
          <Row key={i} label={debtText(d, nameOf, money)} last={i === g.deudas.length - 1} wrap>
            {(d.de === me || d.a === me) && (
              <button type="button" className="s-action-btn s-touch" disabled={busy}
                onClick={() => act(() => addGroupSettlement(id, { de: d.de, a: d.a, importe: d.importe }), 'Pago registrado')}>
                Marcar pagado
              </button>
            )}
          </Row>
        ))}
        <ul className="grp-balances" aria-label="Saldos">
          {g.miembros.map(m => (
            <li key={m.email}><span>{m.nombre}{m.email === me ? ' (tú)' : ''}</span>
              <span className={g.saldos[m.email] > 0 ? 'grp-pos' : g.saldos[m.email] < 0 ? 'grp-neg' : ''}>
                {g.saldos[m.email] > 0 ? '+' : g.saldos[m.email] < 0 ? '−' : ''}{money(Math.abs(g.saldos[m.email] || 0))}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Gastos">
        {!form && <div className="grp-pad"><button type="button" className="s-action-btn s-touch" onClick={() => setForm(true)}>Añadir gasto</button></div>}
        {form && <ExpenseForm g={g} me={me} busy={busy} onCancel={() => setForm(false)}
          onSave={async payload => { if (await act(() => addGroupExpense(id, payload), 'Gasto añadido')) setForm(false) }} />}
        {g.gastos.length === 0 && !form && <p className="s-note">Todavía no hay gastos.</p>}
        <ul className="sub-list">
          {g.gastos.map(x => (
            <li key={x.id} className="sub-item">
              <span className="sub-date"><span className="sub-date-day">{x.fecha.slice(5).split('-').reverse().join('/')}</span></span>
              <span className="sub-name"><span className="sub-concept">{x.concepto}</span>
                <span className="sub-freq">Pagó {nameOf(x.pagado_por)} · {Object.keys(x.partes).length} personas</span></span>
              <span className="sub-amount">{money(x.importe)}</span>
              {(x.creado_por === me || soyCreador) && (
                <button type="button" className="s-action-btn" aria-label={`Borrar gasto ${x.concepto}`} disabled={busy}
                  onClick={() => window.confirm('¿Borrar este gasto?') && act(() => deleteGroupExpense(id, x.id))}>✕</button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {g.pagos.length > 0 && (
        <Section title="Pagos entre miembros">
          <ul className="sub-list">
            {g.pagos.map(p => (
              <li key={p.id} className="sub-item">
                <span className="sub-name"><span className="sub-concept">{nameOf(p.de)} → {nameOf(p.a)}</span><span className="sub-freq">{p.fecha}</span></span>
                <span className="sub-amount">{money(p.importe)}</span>
                {(p.creado_por === me || soyCreador) && (
                  <button type="button" className="s-action-btn" aria-label="Borrar pago" disabled={busy}
                    onClick={() => window.confirm('¿Borrar este pago?') && act(() => deleteGroupSettlement(id, p.id))}>✕</button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Miembros">
        {g.miembros.map(m => <Row key={m.email} icon="👤" label={`${m.nombre}${m.email === g.creado_por ? ' · creador' : ''}`} />)}
        <form className="grp-form" onSubmit={async e => {
          e.preventDefault()
          if (inviteEmail.trim() && await act(() => inviteToGroup(id, inviteEmail.trim()), 'Si la cuenta existe, se ha añadido')) setInviteEmail('')
        }}>
          <input className="fm-input" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@ejemplo.com" aria-label="Email de la persona a añadir" autoCapitalize="none" />
          <button type="submit" className="s-action-btn s-touch" disabled={busy || !inviteEmail.trim()}>Añadir</button>
        </form>
        <p className="s-note">Solo personas que ya tengan cuenta en Mi Economía.</p>
      </Section>

      {soyCreador && (
        <div className="pf-logout-wrap"><button type="button" className="pf-logout" onClick={onDeleteGroup} disabled={busy}>Borrar grupo</button></div>
      )}
    </>
  )
}

function ExpenseForm({ g, me, busy, onSave, onCancel }) {
  const emails = g.miembros.map(m => m.email)
  const [concepto, setConcepto] = useState('')
  const [importe, setImporte] = useState('')
  const [pagador, setPagador] = useState(me)
  const [modo, setModo] = useState('igual')
  const [part, setPart] = useState(() => new Set(emails))
  const [partes, setPartes] = useState({})
  const [err, setErr] = useState('')

  const total = parseAmountInput(importe)
  const preview = modo === 'igual' && total ? equalSplit(total, [...part]) : null
  const diff = modo === 'importes' && total ? splitDifference(total, Object.fromEntries(Object.entries(partes).map(([k, v]) => [k, parseAmountInput(v) || 0]))) : null

  function submit(e) {
    e.preventDefault()
    if (!concepto.trim()) return setErr('Escribe el concepto.')
    if (!total) return setErr('Indica un importe mayor que 0 (ej. 12,50).')
    let reparto
    if (modo === 'igual') {
      if (!part.size) return setErr('Elige al menos una persona.')
      reparto = { modo: 'igual', participantes: [...part] }
    } else {
      const p = {}
      for (const [k, v] of Object.entries(partes)) { const n = parseAmountInput(v); if (n) p[k] = n }
      if (!Object.keys(p).length) return setErr('Indica lo que paga cada persona.')
      if (diff !== 0) return setErr('Las partes deben sumar exactamente el importe.')
      reparto = { modo: 'importes', partes: p }
    }
    setErr('')
    onSave({ concepto: concepto.trim(), importe: total, pagado_por: pagador, reparto })
  }

  return (
    <form className="grp-expense" onSubmit={submit}>
      <input className="fm-input" value={concepto} onChange={e => setConcepto(e.target.value)} maxLength={60} placeholder="Concepto (Cena, Gasolina…)" aria-label="Concepto" />
      <input className="fm-input" inputMode="decimal" value={importe} onChange={e => setImporte(e.target.value)} placeholder="Importe" aria-label="Importe" />
      <label className="grp-label">Pagó
        <select className="fm-input" value={pagador} onChange={e => setPagador(e.target.value)}>
          {g.miembros.map(m => <option key={m.email} value={m.email}>{m.email === me ? 'Yo' : m.nombre}</option>)}
        </select>
      </label>
      <Segmented label="Reparto" options={MODES} value={modo} onChange={setModo} />
      {g.miembros.map(m => (
        <div key={m.email} className="grp-part">
          {modo === 'igual' ? (
            <label><input type="checkbox" checked={part.has(m.email)} onChange={() => setPart(s => { const n = new Set(s); n.has(m.email) ? n.delete(m.email) : n.add(m.email); return n })} /> {m.nombre}</label>
          ) : (
            <><span>{m.nombre}</span><input className="fm-input grp-part-input" inputMode="decimal" aria-label={`Parte de ${m.nombre}`} value={partes[m.email] ?? ''} onChange={e => setPartes(p => ({ ...p, [m.email]: e.target.value }))} placeholder="0" /></>
          )}
          {preview && part.has(m.email) && <span className="grp-share">{preview[m.email]?.toFixed(2).replace('.', ',')} €</span>}
        </div>
      ))}
      {diff !== null && diff !== 0 && <p className="s-note s-note--error">{diff > 0 ? 'Faltan' : 'Sobran'} {Math.abs(diff).toFixed(2).replace('.', ',')} €</p>}
      {err && <p className="s-note s-note--error" role="alert">{err}</p>}
      <div className="grp-actions">
        <button type="button" className="s-action-btn s-touch" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="s-action-btn s-touch" disabled={busy}>Guardar gasto</button>
      </div>
    </form>
  )
}
