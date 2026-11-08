import { useRef, useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useSettings } from '../../context/SettingsContext'
import { postTransaction, createFixedRecurring } from '../../services/api'
import { nextMonthOf } from '../../utils/fixedRecurring'
import { SERVICES, isSubscriptionCategory, composeNote } from '../../data/services'
import ServiceLogo from './ServiceLogo'
import { TYPES, combineCategories, categoryKey } from '../../data/categories'
import { isUnusualAmount, fmt, todayLocal, addDaysLocal } from '../../utils'
import { FormScreen, Field, Section, AmountInput, Chips, PrimaryButton, Icon, SwitchRow } from './FormKit'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { useCategories } from '../../hooks/useCategories'
import { useApp } from '../../context/AppContext'
import { newId } from '../../utils/id'
import { classifyTxError, txErrorMessage, enqueueTx, MSG_OFFLINE } from '../../utils/txQueue'

import { DUPLICATE_CAT_MSG } from './CategoryFields'
import NewCategorySheet, { NewCategoryButton } from './NewCategorySheet'
import Amt from './Amt'

export { DUPLICATE_CAT_MSG }

export default function AddTransactionModal({ onClose }) {
  useLockBodyScroll()
  const [step, setStep]         = useState(1)
  const [selected, setSelected] = useState(null)
  const [showDate, setShowDate] = useState(false)
  const [tipo, setTipo]         = useState(null)
  const [importe, setImporte]   = useState('')
  const [fecha, setFecha]       = useState(todayLocal())
  const [comentario, setComentario] = useState('')
  // Solo para la categoría «Suscripciones»: qué servicio es (Netflix, HBO…). Opcional.
  const [servicio, setServicio] = useState('')
  const [otroServicio, setOtroServicio] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  // Gasto fijo que se repite cada mes: hasta qué mes (o sin fin). Solo para «Gasto Fijo».
  const [repeat, setRepeat]       = useState(false)
  const [sinFin, setSinFin]       = useState(false)
  const [hasta, setHasta]         = useState(() => nextMonthOf(addDaysLocal(330)))

  // Hoja «Nueva categoría»
  const [showNewCat, setShowNewCat] = useState(false)

  const { refresh, data }    = useFinanceData()
  const { showToast }        = useApp()
  // Id de cliente: uno por formulario abierto; se reutiliza en cualquier reintento.
  const clientId             = useRef(null)
  if (!clientId.current) clientId.current = newId()
  const { customCategories } = useSettings()
  const DEFAULT_CATEGORIES = useCategories()

  function handleType(t) { setTipo(t); setStep(2); setShowNewCat(false) }

  async function handleSubmit(concepto) {
    const amt = parseFloat(String(importe).replace(',', '.'))
    if (!amt || amt <= 0) { setError('Introduce un importe válido'); return }
    // Nota final: «Netflix» o «Netflix · nota» si es una suscripción con servicio elegido.
    const nota = composeNote(isSubscriptionCategory(concepto) ? (servicio === '__otro' ? otroServicio : servicio) : '', comentario)
    setLoading(true)
    setError(null)
    try {
      await postTransaction(amt, tipo, concepto, fecha, nota || null, clientId.current)
      if (repeat && tipo === 'Gasto Fijo') {
        // El movimiento ya está guardado: si la repetición falla, se avisa pero no se deshace nada.
        try {
          await createFixedRecurring({
            concepto, importe: amt, dia: Number(fecha.slice(8, 10)) || 1,
            desde: nextMonthOf(fecha), hasta: sinFin ? null : hasta,
          })
          window.dispatchEvent(new Event('fixed-recurring-changed'))
        } catch {
          showToast('Guardado, pero no se pudo programar la repetición. Prueba desde Planificación.')
        }
      }
      refresh()
      onClose()
    } catch (err) {
      if (classifyTxError(err) === 'offline') {
        // Red / timeout / servidor dormido: se guarda en la cola con el mismo
        // id y se reenvía solo al volver la conexión (sin duplicar).
        enqueueTx({ id: clientId.current, importe: amt, tipo, concepto, fecha, comentario: nota || null })
        showToast(MSG_OFFLINE)
        onClose()
        return
      }
      setError(txErrorMessage(err))
      setLoading(false)
    }
  }

  const allCats = tipo ? combineCategories(DEFAULT_CATEGORIES[tipo], customCategories[tipo]) : []
  const amtNum = parseFloat(String(importe).replace(',', '.'))
  const amtOk  = amtNum > 0
  const hoy    = todayLocal()
  const ayer   = addDaysLocal(-1)
  const dateMode = fecha === hoy ? 'hoy' : fecha === ayer ? 'ayer' : 'otra'
  const unusualSel = selected && amtOk ? isUnusualAmount(data, selected, amtNum) : null
  const tipoMeta = TYPES.find(t => t.id === tipo)
  const hastaOk = !repeat || sinFin || (/^\d{4}-\d{2}$/.test(hasta) && hasta >= nextMonthOf(fecha))
  const canSave = !!selected && amtOk && !loading && hastaOk
  const missing = !amtOk ? 'Escribe un importe para continuar'
    : !selected ? 'Elige una categoría para continuar' : 'Elige un mes de fin posterior a este'

  function goBack() { setStep(1); setShowNewCat(false); setSelected(null); setError(null) }

  return (
    <FormScreen
      title={step === 1 ? 'Nuevo movimiento' : tipo}
      subtitle={step === 1 ? '¿Qué quieres registrar?' : 'Importe, fecha y categoría.'}
      onClose={step === 1 ? onClose : goBack}
      headerRight={step === 2 && (
        <button type="button" className="fm-icon-btn" onClick={onClose} aria-label="Cerrar">
          <Icon name="close" />
        </button>
      )}
      footer={step === 2 ? (
        <>
          {error && <p className="fm-error fm-footer-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
          <PrimaryButton loading={loading} disabled={!canSave} hint={missing} onClick={() => handleSubmit(selected)}>
            {amtOk ? <>Guardar <Amt>{fmt(amtNum, Number.isInteger(amtNum) ? 0 : 2)}</Amt></> : 'Guardar movimiento'}
          </PrimaryButton>
        </>
      ) : null}
    >
      {step === 1 && (
        <div className="fm-types">
          {TYPES.map(t => (
            <button key={t.id} type="button" className="fm-type" onClick={() => handleType(t.id)} style={{ '--tc': t.color }}>
              <span className="fm-type-emoji" aria-hidden="true">{t.emoji}</span>
              <span className="fm-type-label">{t.label}</span>
              <span className="fm-type-go" aria-hidden="true"><Icon name="back" size={18} /></span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <>
          <Field label="Importe" error={error && !amtOk ? error : ''}>
            {({ id, describedBy, invalid }) => (
              <AmountInput id={id} describedBy={describedBy} invalid={invalid} value={importe} autoFocus
                placeholder="0,00" onChange={v => { setImporte(v); setError(null) }} />
            )}
          </Field>

          <Field label="Fecha">
            {({ id }) => (
              <>
                <Chips
                  label="Fecha del movimiento"
                  align="start"
                  options={[{ key: 'hoy', label: 'Hoy' }, { key: 'ayer', label: 'Ayer' }, { key: 'otra', label: 'Otra fecha' }]}
                  isActive={o => dateMode === o.key}
                  onPick={o => {
                    if (o.key === 'hoy') { setFecha(hoy); setShowDate(false) }
                    else if (o.key === 'ayer') { setFecha(ayer); setShowDate(false) }
                    else setShowDate(true)
                  }}
                />
                {(showDate || dateMode === 'otra') && (
                  <input id={id} className="fm-input" type="date" value={fecha} max={hoy}
                    onChange={e => setFecha(e.target.value || hoy)} />
                )}
              </>
            )}
          </Field>

          <Field label="Comentario" optional>
            {({ id }) => (
              <input id={id} className="fm-input" type="text" placeholder="Añade una nota…" value={comentario}
                onChange={e => setComentario(e.target.value)} maxLength={200} autoComplete="off" />
            )}
          </Field>

          <Section title="Categoría">
            <NewCategoryButton onClick={() => setShowNewCat(true)} disabled={loading} />
            <div className="fm-grid fm-grid--3" role="radiogroup" aria-label="Categoría">
              {allCats.map(c => {
                const unusual = amtOk ? isUnusualAmount(data, c.concepto, amtNum) : null
                const sel = selected === c.concepto
                return (
                  <button key={categoryKey(tipo, c.concepto)} type="button" role="radio" aria-checked={sel}
                    className={`fm-tile${sel ? ' selected' : ''}`}
                    disabled={loading}
                    onClick={() => { setSelected(c.concepto); setError(null) }}>
                    {unusual && <span className="fm-tile-warn" aria-label="Importe inusual">⚠️</span>}
                    <span className="fm-tile-icon">{c.emoji}</span>
                    <span className="fm-tile-label">{c.concepto}</span>
                    {sel && <span className="fm-tile-check"><Icon name="check" size={13} /></span>}
                  </button>
                )
              })}
            </div>
            {unusualSel && (
              <p className="fm-warn"><span aria-hidden="true">⚠️</span>{unusualSel.ratio}× tu gasto medio en {selected}</p>
            )}
          </Section>

          {selected && isSubscriptionCategory(selected) && (
            <Section title="¿Qué suscripción es?">
              <div className="svc-picker" role="radiogroup" aria-label="Servicio">
                {SERVICES.map(sv => (
                  <button key={sv.id} type="button" role="radio" aria-checked={servicio === sv.nombre}
                    className={`svc-chip${servicio === sv.nombre ? ' selected' : ''}`}
                    onClick={() => setServicio(servicio === sv.nombre ? '' : sv.nombre)}>
                    <ServiceLogo nombre={sv.nombre} size={36} />
                    <span className="svc-chip-name">{sv.nombre}</span>
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={servicio === '__otro'}
                  className={`svc-chip${servicio === '__otro' ? ' selected' : ''}`}
                  onClick={() => setServicio(servicio === '__otro' ? '' : '__otro')}>
                  <span className="svc-logo" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface2)', color: 'var(--text)' }} aria-hidden="true">+</span>
                  <span className="svc-chip-name">Otra</span>
                </button>
              </div>
              {servicio === '__otro' && (
                <input className="fm-input" value={otroServicio} maxLength={40} placeholder="Nombre de la suscripción"
                  aria-label="Nombre de la suscripción" onChange={e => setOtroServicio(e.target.value)} autoComplete="off" />
              )}
              <p className="fm-hint">Opcional: así verás cuánto gastas en cada una.</p>
            </Section>
          )}

          {tipo === 'Gasto Fijo' && (
            <Section title="Repetición">
              <SwitchRow checked={repeat} onChange={setRepeat} title="Repetir cada mes"
                desc="Aparecerá solo en los meses siguientes con este importe. No lo actives si el importe cambia cada mes (la luz)." />
              {repeat && (
                <>
                  <SwitchRow checked={sinFin} onChange={setSinFin} title="Sin fecha de fin" desc="Hasta que lo pares tú." />
                  {!sinFin && (
                    <Field label="Hasta el mes de" error={hastaOk ? '' : 'Elige un mes posterior al de este gasto'}>
                      {({ id }) => (
                        <input id={id} className="fm-input" type="month" value={hasta} min={nextMonthOf(fecha)}
                          onChange={e => setHasta(e.target.value)} />
                      )}
                    </Field>
                  )}
                </>
              )}
            </Section>
          )}

          {showNewCat && (
            <NewCategorySheet tipo={tipo} existing={allCats}
              onCreated={name => { setSelected(name); setError(null) }}
              onClose={() => setShowNewCat(false)} />
          )}
        </>
      )}
    </FormScreen>
  )
}
