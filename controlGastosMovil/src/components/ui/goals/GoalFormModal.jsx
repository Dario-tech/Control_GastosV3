import { useState } from 'react'
import { useLockBodyScroll } from '../../../hooks/useLockBodyScroll'
import { fmt } from '../../../utils'
import { FormScreen, Field, Section, AmountInput, Chips, TileGrid, PrimaryButton } from '../FormKit'
import { GoalRing } from './GoalRing'
import { goalRemaining, formatGoalDate, toIso, addMonthsIso } from './goalUtils'

const GOAL_EMOJIS = ['🎯', '🏖️', '🚗', '🏠', '💍', '🎓', '✈️', '💻', '🛟', '🎁']
const DATE_SHORTCUTS = [
  { key: '6m',  label: 'En 6 meses',   iso: () => addMonthsIso(6) },
  { key: 'eoy', label: 'Fin de año',   iso: () => `${new Date().getFullYear()}-12-31` },
  { key: '1y',  label: '1 año',        iso: () => addMonthsIso(12) },
  { key: '2y',  label: '2 años',       iso: () => addMonthsIso(24) },
  { key: 'none', label: 'Sin fecha',   iso: () => '' },
]
const GOAL_QUICK = [1000, 3000, 5000, 10000].map(v => ({ key: v, label: fmt(v), value: v }))

export default function GoalFormModal({ goal, onSave, onClose }) {
  useLockBodyScroll()
  const [nombre, setNombre]     = useState(goal?.nombre ?? '')
  const [objetivo, setObjetivo] = useState(goal?.objetivo != null ? String(goal.objetivo) : '')
  const [fecha, setFecha]       = useState(goal?.fecha ?? '')
  const [emoji, setEmoji]       = useState(goal?.emoji ?? '🎯')
  const [touched, setTouched]   = useState({})
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const touch = k => setTouched(t => ({ ...t, [k]: true }))
  const objetivoNum = parseFloat(String(objetivo).replace(',', '.'))
  const nombreOk   = nombre.trim().length > 0
  const objetivoOk = objetivoNum > 0
  const canSave = nombreOk && objetivoOk && !saving
  const pastDate = !!fecha && fecha < toIso(new Date())

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      await onSave({ nombre: nombre.trim(), objetivo: objetivoNum, fecha: fecha || null, emoji })
    } catch (e) {
      setError(e.message || 'No se pudo guardar')
      setSaving(false)
    }
  }

  // Vista previa: anillo con el progreso real (al editar) y cuota mensual estimada.
  const prevGoal = { objetivo: objetivoOk ? objetivoNum : 0, ahorrado: goal?.ahorrado ?? 0, fecha: fecha || null }
  const prevPct  = prevGoal.objetivo > 0 ? Math.min(100, (prevGoal.ahorrado / prevGoal.objetivo) * 100) : 0
  const prevRem  = goalRemaining(prevGoal)

  const missing = !nombreOk ? 'Ponle un nombre a tu meta para continuar' : 'Indica un objetivo mayor que 0'

  return (
    <FormScreen
      title={goal ? 'Editar meta' : 'Nueva meta'}
      subtitle="Elige un icono, ponle nombre y fija cuánto quieres ahorrar."
      onClose={onClose}
      error={error}
      footer={
        <PrimaryButton loading={saving} disabled={!canSave} hint={missing} onClick={submit}>
          {goal ? 'Guardar cambios' : 'Crear meta'}
        </PrimaryButton>
      }
    >
      {/* Vista previa en vivo: la tarjeta tal y como se verá en Planificación */}
      <div className="fm-preview fm-preview--goal" aria-label="Vista previa de la meta">
        <span className="fm-preview-tag">Vista previa</span>
        <GoalRing pct={prevPct} size="lg">
          <span className="fm-preview-ring-emoji">{emoji}</span>
        </GoalRing>
        <div className="fm-preview-goal-name">
          <span className={nombreOk ? '' : 'muted'}>{nombreOk ? nombre.trim() : 'Nombre de tu meta'}</span>
        </div>
        <div className="fm-preview-goal-amounts tabular">
          <b>{fmt(prevGoal.ahorrado)}</b> / {fmt(prevGoal.objetivo)}
        </div>
        <span className="fm-preview-foot tabular">
          {prevRem.mes != null
            ? `≈ ${fmt(prevRem.mes)}/mes hasta ${formatGoalDate(fecha)}`
            : (fecha ? `Para ${formatGoalDate(fecha)}` : 'Sin fecha límite')}
        </span>
      </div>

      <Section title="Icono">
        <TileGrid
          label="Icono de la meta"
          columns={5}
          items={GOAL_EMOJIS.map(e => ({ key: e, icon: e, ariaLabel: `Icono ${e}`, emoji: e }))}
          isSelected={it => emoji === it.emoji}
          onSelect={it => setEmoji(it.emoji)}
        />
      </Section>

      <Field label="Nombre" error={touched.nombre && !nombreOk ? 'Escribe un nombre para tu meta.' : ''}>
        {({ id, describedBy, invalid }) => (
          <input id={id} className="fm-input" value={nombre} maxLength={40}
            aria-invalid={invalid || undefined} aria-describedby={describedBy}
            onChange={e => setNombre(e.target.value)} onBlur={() => touch('nombre')}
            placeholder="Vacaciones, coche nuevo…" autoComplete="off" enterKeyHint="next" />
        )}
      </Field>

      <Field label="Objetivo" error={touched.objetivo && !objetivoOk ? 'Introduce un objetivo mayor que 0.' : ''}>
        {({ id, describedBy, invalid }) => (
          <>
            <AmountInput id={id} describedBy={describedBy} invalid={invalid} value={objetivo}
              onChange={setObjetivo} onBlur={() => touch('objetivo')} />
            <Chips
              label="Objetivos rápidos"
              options={GOAL_QUICK}
              isActive={o => objetivoNum === o.value}
              onPick={o => { setObjetivo(String(o.value)); touch('objetivo') }}
            />
          </>
        )}
      </Field>

      <Field
        label="Fecha objetivo"
        optional
        hint={!fecha ? 'Con una fecha te decimos cuánto aportar al mes.' : ''}
        error={pastDate ? 'Esa fecha ya ha pasado: no podremos calcular una cuota mensual.' : ''}
      >
        {({ id, describedBy, invalid }) => (
          <>
            <input id={id} className="fm-input" type="date" value={fecha}
              aria-invalid={invalid || undefined} aria-describedby={describedBy}
              onChange={e => setFecha(e.target.value)} />
            <Chips
              label="Atajos de fecha"
              options={DATE_SHORTCUTS}
              isActive={o => (o.key === 'none' ? !fecha : fecha === o.iso())}
              onPick={o => setFecha(o.iso())}
            />
          </>
        )}
      </Field>

    </FormScreen>
  )
}
