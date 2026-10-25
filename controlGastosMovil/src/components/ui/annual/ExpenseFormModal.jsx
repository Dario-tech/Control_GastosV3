import { useState } from 'react'
import { useLockBodyScroll } from '../../../hooks/useLockBodyScroll'
import { fmt } from '../../../utils'
import { MONTH_NAMES } from '../../../data/mockData'
import { FormScreen, Field, Section, AmountInput, Chips, Segmented, SwitchRow, PrimaryButton, Icon } from '../FormKit'
import { dueState } from './annualUtils'
import Amt from '../Amt'

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
const IMPORTE_QUICK_VALUES = [100, 250, 500, 1000]
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x))

export default function ExpenseFormModal({ expense, onSave, onClose }) {
  const IMPORTE_QUICK = IMPORTE_QUICK_VALUES.map(v => ({ key: v, label: fmt(v), value: v }))
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
          <span className="fm-preview-amount tabular"><Amt>{fmt(importeOk ? importeNum : 0)}</Amt></span>
        </div>
        <div className="fm-preview-chips">
          {due && <span className="annual-due-chip"><span aria-hidden="true">{due.icon}</span>{due.label}</span>}
          {porMes != null && <span className="fm-pill tabular">Equivale a <Amt>{fmt(porMes)}</Amt>/mes{cuotas > 0 ? ` · ${cuotas} cuota${cuotas !== 1 ? 's' : ''}` : ''}</span>}
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
                Apartarás <b><Amt>{fmt(importeNum / mesesSel.size)}</Amt></b>/mes en {mesesSel.size} mes{mesesSel.size !== 1 ? 'es' : ''}
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
