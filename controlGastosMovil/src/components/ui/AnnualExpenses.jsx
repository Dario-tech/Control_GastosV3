import { useState, useEffect } from 'react'
import { useAnnualExpenses } from '../../hooks/useAnnualExpenses'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { fmt } from '../../utils'

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

const NOTIF_LS_KEY = 'mi-economia-annual-notif-v1'
function getNotifCache() {
  try { return JSON.parse(localStorage.getItem(NOTIF_LS_KEY) || '{}') } catch { return {} }
}
function setNotifCache(cache) {
  localStorage.setItem(NOTIF_LS_KEY, JSON.stringify(cache))
}

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

function downloadIcs(expense) {
  const blob = new Blob([buildIcs(expense)], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), {
    href: url, download: `${expense.nombre.replace(/[^\w-]/g, '_')}.ics`,
  })
  a.click()
  URL.revokeObjectURL(url)
}

function ExpenseFormModal({ expense, onSave, onClose }) {
  useLockBodyScroll()
  const [nombre, setNombre]     = useState(expense?.nombre ?? '')
  const [importe, setImporte]   = useState(expense?.importe != null ? String(expense.importe) : '')
  const [mes, setMes]           = useState(expense?.mes ?? new Date().getMonth() + 1)
  const [dia, setDia]           = useState(expense?.dia ?? 1)
  const [dividir, setDividir]   = useState(Boolean(expense?.meses_reparto?.length))
  const [mesesSel, setMesesSel] = useState(() => new Set(expense?.meses_reparto?.length ? expense.meses_reparto : []))

  // Al activar "repartir" por primera vez (sin selección todavía), preselecciona
  // el mes de vencimiento actual como punto de partida cómodo.
  function handleToggleDividir(checked) {
    setDividir(checked)
    if (checked && mesesSel.size === 0) setMesesSel(new Set([Number(mes)]))
  }
  const [avisar, setAvisar]     = useState(expense?.avisar ?? true)
  const [diasAviso, setDiasAviso] = useState(expense?.dias_aviso != null ? String(expense.dias_aviso) : '15')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const importeNum = parseFloat(String(importe).replace(',', '.'))
  const diasNum    = parseInt(diasAviso, 10)
  const canSave = nombre.trim() && importeNum > 0 && !saving
    && (!dividir || mesesSel.size >= 1)

  function toggleMes(m) {
    setMesesSel(prev => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m); else next.add(m)
      return next
    })
  }

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      await onSave({
        nombre: nombre.trim(), importe: importeNum, mes: Number(mes), dia: Number(dia),
        meses_reparto: dividir ? [...mesesSel].sort((a, b) => a - b) : null,
        avisar, dias_aviso: diasNum || 15,
      })
    } catch (e) {
      setError(e.message || 'No se pudo guardar')
      setSaving(false)
    }
  }

  return (
    <div className="annual-form-screen">
      <div className="annual-form-topbar">
        <button className="profile-back-btn" onClick={onClose} aria-label="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <span className="annual-form-title">{expense ? 'Editar gasto fijo' : 'Nuevo gasto fijo anual'}</span>
      </div>

      <div className="annual-form-body">
        <label className="goal-field-label">Nombre</label>
        <input className="setup-input" value={nombre} onChange={e => setNombre(e.target.value)}
          placeholder="IBI, seguro del coche…" maxLength={40} />

        <label className="goal-field-label">Importe (€)</label>
        <input className="setup-input" inputMode="decimal" value={importe}
          onChange={e => setImporte(e.target.value)} placeholder="450" />

        <div className="goal-field-row">
          <div style={{ flex: 1 }}>
            <label className="goal-field-label">Mes de vencimiento</label>
            <select className="setup-input" value={mes} onChange={e => setMes(e.target.value)}>
              {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div style={{ width: 90 }}>
            <label className="goal-field-label">Día</label>
            <input className="setup-input" type="number" min="1" max="31" value={dia}
              onChange={e => setDia(e.target.value)} />
          </div>
        </div>

        <label className="annual-check-row">
          <input type="checkbox" checked={dividir} onChange={e => handleToggleDividir(e.target.checked)} />
          <span>Repartir el gasto en varios meses (te digo cuánto apartar al mes)</span>
        </label>
        {dividir && (
          <div style={{ marginBottom: 10 }}>
            <div className="annual-months-grid">
              {MONTH_NAMES.map((m, i) => {
                const num = i + 1
                const active = mesesSel.has(num)
                return (
                  <button
                    key={num}
                    type="button"
                    className={`annual-month-chip${active ? ' active' : ''}`}
                    onClick={() => toggleMes(num)}
                  >
                    {m.slice(0, 3)}
                  </button>
                )
              })}
            </div>
            {importeNum > 0 && mesesSel.size > 0 && (
              <p className="annual-months-hint">
                Apartarás {fmt(importeNum / mesesSel.size)}/mes en {mesesSel.size} mes{mesesSel.size !== 1 ? 'es' : ''}
              </p>
            )}
          </div>
        )}

        <label className="annual-check-row">
          <input type="checkbox" checked={avisar} onChange={e => setAvisar(e.target.checked)} />
          <span>Avisarme cuando se acerque</span>
        </label>
        {avisar && (
          <div className="goal-field-row" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>Con antelación de</span>
            <input className="setup-input" type="number" min="1" max="90" value={diasAviso}
              onChange={e => setDiasAviso(e.target.value)} style={{ width: 70 }} />
            <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>días</span>
          </div>
        )}

        {error && <p className="cat-err" style={{ marginTop: 8 }}>{error}</p>}

        <button className="setup-btn" style={{ marginTop: 16, opacity: canSave ? 1 : 0.5 }}
          onClick={submit} disabled={!canSave}>
          {saving ? 'Guardando…' : (expense ? 'Guardar' : 'Crear gasto fijo')}
        </button>
      </div>
    </div>
  )
}

export default function AnnualExpenses() {
  const { expenses, status, addExpense, editExpense, removeExpense } = useAnnualExpenses()
  const [showForm, setShowForm]   = useState(false)
  const [formExpense, setFormExpense] = useState(null)
  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  )

  function openCreate()    { setFormExpense(null); setShowForm(true) }
  function openEdit(exp)   { setFormExpense(exp); setShowForm(true) }
  function closeForm()     { setShowForm(false); setFormExpense(null) }

  async function handleSave(data) {
    if (formExpense) await editExpense(formExpense.id, data)
    else             await addExpense(data)
    closeForm()
  }

  async function handleDelete(exp) {
    if (!window.confirm(`¿Eliminar "${exp.nombre}"?`)) return
    await removeExpense(exp.id)
  }

  async function requestNotifPermission() {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }

  // Avisa (notificación del navegador) una vez al día por cada gasto cuyo
  // aviso esté activo — igual que las alertas de presupuesto ya existentes.
  useEffect(() => {
    if (notifPermission !== 'granted') return
    const today = new Date().toISOString().slice(0, 10)
    const cache = getNotifCache()
    let changed = false
    expenses.forEach(exp => {
      if (!exp.aviso_activo) return
      const key = `${exp.id}-${today}`
      if (cache[key]) return
      cache[key] = true
      changed = true
      new Notification(`📅 ${exp.nombre}`, {
        body: `Vence en ${exp.dias_restantes} día${exp.dias_restantes !== 1 ? 's' : ''} — ${fmt(exp.importe)}`,
        icon: '/icons/icon-192.png',
        tag: key,
      })
    })
    if (changed) setNotifCache(cache)
  }, [expenses, notifPermission])

  if (status !== 'error' && expenses.length === 0 && !showForm) {
    return (
      <div className="goals-section" data-tour="annual-expenses">
        <div className="goals-header">
          <span className="goals-title">📅 Gastos fijos anuales</span>
        </div>
        <p className="goals-empty">
          IBI, seguro del coche… configúralos una vez y la app te avisa cuando se acercan.
        </p>
        <button className="budget-fab" onClick={openCreate}>Añadir gasto fijo</button>
        {showForm && <ExpenseFormModal expense={formExpense} onSave={handleSave} onClose={closeForm} />}
      </div>
    )
  }

  return (
    <div className="goals-section" data-tour="annual-expenses">
      <div className="goals-header">
        <span className="goals-title">📅 Gastos fijos anuales</span>
        <button className="goal-share-btn" onClick={openCreate}>+ Añadir</button>
      </div>

      {status === 'error' && <p className="goals-empty">No se pudieron cargar los gastos fijos.</p>}

      {notifPermission === 'default' && expenses.some(e => e.avisar) && (
        <button className="notif-banner" onClick={requestNotifPermission}>
          <span>🔔</span>
          <span>Activa las notificaciones para que te avise cuando se acerquen</span>
          <span className="notif-banner-cta">Activar →</span>
        </button>
      )}

      <div className="annual-list">
        {expenses.map(exp => (
          <div key={exp.id} className={`annual-item${exp.aviso_activo ? ' annual-item--soon' : ''}`}>
            <div className="annual-item-top" onClick={() => openEdit(exp)}>
              <div className="annual-item-left">
                <span className="annual-item-name">{exp.nombre}</span>
                <span className="annual-item-due">
                  {exp.dias_restantes === 0 ? 'Vence hoy' : `Vence en ${exp.dias_restantes} días`}
                  {' · '}{exp.dia} de {MONTH_NAMES[exp.mes - 1]}
                </span>
                {exp.reparto_mensual != null && (
                  <span className="annual-item-split">
                    Aparta {fmt(exp.reparto_mensual)}/mes en {exp.meses_reparto.map(m => MONTH_NAMES[m - 1].slice(0, 3)).join(', ')}
                  </span>
                )}
              </div>
              <span className="annual-item-amount">{fmt(exp.importe)}</span>
            </div>
            <div className="annual-item-actions">
              <button className="annual-item-btn" onClick={() => downloadIcs(exp)}>📅 Recordatorio</button>
              <button className="annual-item-btn danger" onClick={() => handleDelete(exp)}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>

      {showForm && <ExpenseFormModal expense={formExpense} onSave={handleSave} onClose={closeForm} />}
    </div>
  )
}
