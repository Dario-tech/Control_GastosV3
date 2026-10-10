import { useState, useEffect } from 'react'
import { useAnnualExpenses } from '../../hooks/useAnnualExpenses'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { fmt } from '../../utils'
import { FormScreen, Field, Section, AmountInput, Chips, Segmented, SwitchRow, PrimaryButton, ConfirmSheet, Icon } from './FormKit'

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

// Cuánto del reparto ya ha caído en un mes pasado (o el actual) — para que se
// vea que la anualidad se va "pagando" a medida que pasan esos meses, igual
// que ya se descuenta del saldo de cada mes en Mes/Stats/Año.
function annualProgress(expense) {
  if (!expense.meses_reparto?.length) return null
  const mesActual = new Date().getMonth() + 1
  const pasados = expense.meses_reparto.filter(m => m <= mesActual).length
  const pagado = Math.round(pasados * expense.reparto_mensual * 100) / 100
  return { pasados, total: expense.meses_reparto.length, pagado, pendiente: Math.round((expense.importe - pagado) * 100) / 100 }
}

// Estado según el vencimiento: color + icono + texto
function dueState(exp) {
  const d = exp.dias_restantes
  if (d < 0)  return { key: 'overdue', icon: '✕', label: `Vencido hace ${-d} día${d !== -1 ? 's' : ''}` }
  if (d === 0) return { key: 'soon',   icon: '!', label: 'Vence hoy' }
  if (exp.aviso_activo || d <= 30)
              return { key: 'soon',   icon: '!', label: `En ${d} día${d !== 1 ? 's' : ''}` }
  return        { key: 'far',    icon: '✓', label: `En ${d} días` }
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

const DUE_TOTAL_DAYS = (m, d) => {
  // Días hasta el próximo vencimiento (solo para la vista previa del formulario).
  const today = new Date(); today.setHours(0, 0, 0, 0)
  let due = new Date(today.getFullYear(), m - 1, d)
  if (due < today) due = new Date(today.getFullYear() + 1, m - 1, d)
  return Math.round((due - today) / 86400000)
}

// Meses en que se aparta una cuota: `count` cuotas repartidas de forma uniforme
// terminando en el mes de vencimiento.
function spreadMonths(count, mesVto) {
  const step = 12 / count
  const out = new Set()
  for (let i = 0; i < count; i++) out.add(((Math.round(mesVto - i * step) - 1 + 120) % 12) + 1)
  return out
}
const REPARTO_PRESETS = [
  { key: 'm12', label: 'Cada mes',   count: 12 },
  { key: 'm4',  label: 'Trimestral', count: 4 },
  { key: 'm2',  label: 'Semestral',  count: 2 },
  { key: 'm1',  label: 'Solo al vencer', count: 1 },
]
const AVISO_PRESETS = [7, 15, 30].map(v => ({ key: v, label: `${v} días`, value: v }))
const IMPORTE_QUICK = [100, 250, 500, 1000].map(v => ({ key: v, label: fmt(v), value: v }))
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x))

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
  const [touched, setTouched]   = useState({})
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const touch = k => setTouched(t => ({ ...t, [k]: true }))
  const importeNum = parseFloat(String(importe).replace(',', '.'))
  const diasNum    = parseInt(diasAviso, 10)
  const nombreOk   = nombre.trim().length > 0
  const importeOk  = importeNum > 0
  const maxDia     = new Date(2024, Number(mes), 0).getDate()   // año bisiesto: febrero admite 29
  const diaNum     = parseInt(dia, 10)
  const diaOk      = Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= maxDia
  const repartoOk  = !dividir || mesesSel.size >= 1
  const canSave = nombreOk && importeOk && diaOk && repartoOk && !saving

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

  // Vista previa: tarjeta de gasto fijo con cuenta atrás y equivalencia mensual.
  const diasRest = diaOk ? DUE_TOTAL_DAYS(Number(mes), diaNum) : null
  const due = diasRest != null
    ? dueState({ dias_restantes: diasRest, aviso_activo: avisar && diasRest <= (diasNum || 15) })
    : null
  const cuotas = dividir ? mesesSel.size : 0
  const porMes = importeOk ? (cuotas > 0 ? importeNum / cuotas : importeNum / 12) : null

  const missing = !nombreOk ? 'Ponle un nombre al gasto para continuar'
    : !importeOk ? 'Indica un importe mayor que 0'
    : !diaOk ? 'Revisa el día de vencimiento'
    : 'Elige al menos un mes para repartir'

  return (
    <FormScreen
      title={expense ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
      subtitle="IBI, seguro, impuestos… te aviso y te digo cuánto apartar."
      onClose={onClose}
      error={error}
      footer={
        <PrimaryButton loading={saving} disabled={!canSave} hint={missing} onClick={submit}>
          {expense ? 'Guardar cambios' : 'Crear gasto fijo'}
        </PrimaryButton>
      }
    >
      {/* Vista previa en vivo */}
      <div className={`fm-preview fm-preview--annual${due ? ` annual-st-${due.key}` : ''}`} aria-label="Vista previa del gasto fijo">
        <span className="fm-preview-tag">Vista previa</span>
        <div className="fm-preview-row">
          <span className="fm-preview-tile" aria-hidden="true">🧾</span>
          <div className="fm-preview-main">
            <span className={`fm-preview-name${nombreOk ? '' : ' muted'}`}>{nombreOk ? nombre.trim() : 'Nombre del gasto'}</span>
            <span className="fm-preview-sub">{diaOk ? `${diaNum} de ${MONTH_NAMES[Number(mes) - 1]}` : 'Fecha de vencimiento'}</span>
          </div>
          <span className="fm-preview-amount tabular">{fmt(importeOk ? importeNum : 0)}</span>
        </div>
        <div className="fm-preview-chips">
          {due && <span className="annual-due-chip"><span aria-hidden="true">{due.icon}</span>{due.label}</span>}
          {porMes != null && <span className="fm-pill tabular">Equivale a {fmt(porMes)}/mes{cuotas > 0 ? ` · ${cuotas} cuota${cuotas !== 1 ? 's' : ''}` : ''}</span>}
        </div>
      </div>

      <div className="fm-card fm-group">
        <Field label="Nombre" error={touched.nombre && !nombreOk ? 'Escribe un nombre para el gasto.' : ''}>
          {({ id, describedBy, invalid }) => (
            <input id={id} className="fm-input" value={nombre} maxLength={40}
              aria-invalid={invalid || undefined} aria-describedby={describedBy}
              onChange={e => setNombre(e.target.value)} onBlur={() => touch('nombre')}
              placeholder="IBI, seguro del coche…" autoComplete="off" enterKeyHint="next" />
          )}
        </Field>

        <Field label="Importe anual" error={touched.importe && !importeOk ? 'Introduce un importe mayor que 0.' : ''}>
          {({ id, describedBy, invalid }) => (
            <>
              <AmountInput id={id} describedBy={describedBy} invalid={invalid} value={importe}
                onChange={setImporte} onBlur={() => touch('importe')} />
              <Chips
                label="Importes rápidos"
                options={IMPORTE_QUICK}
                isActive={o => importeNum === o.value}
                onPick={o => { setImporte(String(o.value)); touch('importe') }}
              />
            </>
          )}
        </Field>
      </div>

      <Section title="Vencimiento">
        <div className="fm-card fm-group">
          <div className="fm-field">
            <span className="fm-label">Mes</span>
            <div className="fm-months" role="radiogroup" aria-label="Mes de vencimiento">
              {MONTH_NAMES.map((m, i) => (
                <button key={m} type="button" role="radio" aria-checked={Number(mes) === i + 1}
                  className="fm-month" onClick={() => setMes(i + 1)}>
                  {m.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
          <Field label="Día del mes" className="fm-day-field">
            {({ id, describedBy }) => (
              <input id={id} className="fm-input fm-input--center tabular" type="number" inputMode="numeric"
                min="1" max={maxDia} value={dia} aria-invalid={!diaOk || undefined} aria-describedby={describedBy}
                onChange={e => setDia(e.target.value)} />
            )}
          </Field>
          {!diaOk && <p className="fm-error" role="alert"><Icon name="alert" size={15} />El día debe estar entre 1 y {maxDia} para {MONTH_NAMES[Number(mes) - 1].toLowerCase()}.</p>}
        </div>
      </Section>

      <Section title="Cómo apartarlo">
        <Segmented
          label="Cómo apartar el gasto"
          value={dividir}
          onChange={handleToggleDividir}
          options={[{ id: false, label: 'Un solo pago' }, { id: true, label: 'Repartir en cuotas' }]}
        />
        {dividir && (
          <div className="fm-card fm-reparto">
            <Chips
              label="Periodicidad"
              align="start"
              options={REPARTO_PRESETS}
              isActive={o => sameSet(mesesSel, spreadMonths(o.count, Number(mes)))}
              onPick={o => setMesesSel(spreadMonths(o.count, Number(mes)))}
            />
            <div className="fm-months" role="group" aria-label="Meses en los que apartar">
              {MONTH_NAMES.map((m, i) => {
                const num = i + 1
                const active = mesesSel.has(num)
                return (
                  <button
                    key={num}
                    type="button"
                    aria-pressed={active}
                    className="fm-month"
                    onClick={() => toggleMes(num)}
                  >
                    {m.slice(0, 3)}
                  </button>
                )
              })}
            </div>
            {mesesSel.size === 0 ? (
              <p className="fm-error" role="alert"><Icon name="alert" size={15} />Elige al menos un mes.</p>
            ) : importeOk ? (
              <p className="fm-reparto-sum tabular">
                Apartarás <b>{fmt(importeNum / mesesSel.size)}</b>/mes en {mesesSel.size} mes{mesesSel.size !== 1 ? 'es' : ''}
              </p>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Aviso">
        <SwitchRow
          checked={avisar}
          onChange={setAvisar}
          title="Avisarme cuando se acerque"
          desc="Recibirás una notificación antes del vencimiento"
        />
        {avisar && (
          <div className="fm-card fm-aviso">
            <span className="fm-label">Con antelación de</span>
            <Chips
              label="Días de antelación"
              align="start"
              options={AVISO_PRESETS}
              isActive={o => diasNum === o.value}
              onPick={o => setDiasAviso(String(o.value))}
            />
            <div className="fm-aviso-custom">
              <input className="fm-input fm-input--center tabular" type="number" inputMode="numeric" min="1" max="90"
                aria-label="Días de antelación" value={diasAviso} onChange={e => setDiasAviso(e.target.value)} />
              <span>días antes</span>
            </div>
          </div>
        )}
      </Section>

    </FormScreen>
  )
}

export default function AnnualExpenses() {
  const { expenses, status, addExpense, editExpense, removeExpense } = useAnnualExpenses()
  const [showForm, setShowForm]   = useState(false)
  const [formExpense, setFormExpense] = useState(null)
  const [confirmExp, setConfirmExp] = useState(null)
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
    await removeExpense(exp.id)
    setConfirmExp(null)
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

  const sorted     = [...expenses].sort((a, b) => a.dias_restantes - b.dias_restantes)
  const totalAnual = expenses.reduce((t, e) => t + (e.importe || 0), 0)

  if (status !== 'error' && expenses.length === 0 && !showForm) {
    return (
      <div className="goals-section" data-tour="annual-expenses">
        <div className="goals-header">
          <span className="goals-title">📅 Gastos fijos anuales</span>
        </div>
        <div className="annual-empty">
          <div className="annual-empty-icon" aria-hidden="true">📅</div>
          <h3 className="annual-empty-title">Sin gastos fijos anuales</h3>
          <p className="annual-empty-desc">
            IBI, seguro del coche… configúralos una vez y la app te avisa cuando se acercan.
          </p>
          <button className="annual-primary-btn" onClick={openCreate}>Añadir gasto fijo</button>
        </div>
        {showForm && <ExpenseFormModal expense={formExpense} onSave={handleSave} onClose={closeForm} />}
      </div>
    )
  }

  return (
    <div className="goals-section" data-tour="annual-expenses">
      <div className="goals-header">
        <span className="goals-title">📅 Gastos fijos anuales</span>
        <button className="annual-add-btn" onClick={openCreate}>+ Añadir</button>
      </div>

      {status === 'error' && <p className="goals-empty">No se pudieron cargar los gastos fijos.</p>}

      {notifPermission === 'default' && expenses.some(e => e.avisar) && (
        <button className="notif-banner" onClick={requestNotifPermission}>
          <span>🔔</span>
          <span>Activa las notificaciones para que te avise cuando se acerquen</span>
          <span className="notif-banner-cta">Activar →</span>
        </button>
      )}

      {expenses.length > 0 && (
        <div className="annual-summary">
          <span className="annual-summary-label">A reservar al mes</span>
          <span className="annual-summary-main tabular">{fmt(totalAnual / 12)}</span>
          <span className="annual-summary-sub tabular">
            Total anual {fmt(totalAnual)} · {expenses.length} gasto{expenses.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="annual-list">
        {sorted.map(exp => {
          const progress = annualProgress(exp)
          const due = dueState(exp)
          return (
          <div key={exp.id} className={`annual-item annual-st-${due.key}`}>
            <div className="annual-item-top" onClick={() => openEdit(exp)}>
              <span className="annual-item-icon" aria-hidden="true">🧾</span>
              <div className="annual-item-left">
                <span className="annual-item-name">{exp.nombre}</span>
                <span className="annual-item-due">{exp.dia} de {MONTH_NAMES[exp.mes - 1]}</span>
                <span className="annual-due-chip"><span aria-hidden="true">{due.icon}</span>{due.label}</span>
              </div>
              <span className="annual-item-amount">{fmt(exp.importe)}</span>
            </div>
            {exp.reparto_mensual != null && (
              <div className="annual-quota">
                <div className="annual-quota-dots" aria-hidden="true">
                  {exp.meses_reparto.map((m, i) => (
                    <span key={m} className={`annual-quota-dot${progress && i < progress.pasados ? ' done' : ''}`} />
                  ))}
                </div>
                <span className="annual-quota-text tabular">
                  {progress ? progress.pasados : 0}/{exp.meses_reparto.length} cuotas · {fmt(exp.reparto_mensual)}/mes
                </span>
              </div>
            )}
            <div className="annual-item-actions">
              <button className="annual-item-btn" onClick={() => downloadIcs(exp)}>📅 Recordatorio</button>
              <button className="annual-item-btn danger" onClick={() => setConfirmExp(exp)}>Eliminar</button>
            </div>
          </div>
          )
        })}
      </div>

      {showForm && <ExpenseFormModal expense={formExpense} onSave={handleSave} onClose={closeForm} />}
      {confirmExp && (
        <ConfirmSheet
          title={`¿Eliminar "${confirmExp.nombre}"?`}
          message="Dejarás de recibir avisos y se quitará de tu reparto mensual."
          onCancel={() => setConfirmExp(null)}
          onConfirm={() => handleDelete(confirmExp)}
        />
      )}
    </div>
  )
}
