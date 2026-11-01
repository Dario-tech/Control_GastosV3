import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '../../context/SettingsContext'
import { useCategories } from '../../hooks/useCategories'
import { updateTransaction, deleteTransaction } from '../../services/api'
import { TYPES, combineCategories, categoryKey, normalizeCategoryName } from '../../data/categories'
import { todayLocal, addDaysLocal } from '../../utils'
import {
  draftFromTx, validateDraft, buildTransactionPatch, parseAmount, dayLabel,
} from '../../utils/txlog'
import { fmtAmount } from '../../utils/amounts'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import {
  FormScreen, Field, Section, AmountInput, Chips, Segmented, PrimaryButton, DangerButton, ConfirmSheet, Icon,
} from './FormKit'
import NewCategorySheet, { NewCategoryButton } from './NewCategorySheet'

const TIPO_OPTIONS = [
  { id: 'Gasto Variable', label: 'Variable' },
  { id: 'Gasto Fijo',     label: 'Fijo' },
  { id: 'Ingreso',        label: 'Ingreso' },
]

function apiErrorMessage(err, fallback) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return 'El servidor está despertando, puede tardar unos segundos. Vuelve a intentarlo.'
  }
  const msg = err?.message || ''
  // apiJson lanza `detail` del backend (en español) o "API <status>" si no hay.
  return msg && !/^API \d+$/.test(msg) && !/fetch/i.test(msg) ? msg : fallback
}

// Misma categoría aunque cambien mayúsculas, acentos o espacios.
const sameName = (a, b) => a != null && b != null && normalizeCategoryName(a) === normalizeCategoryName(b)

/**
 * Editor de un movimiento existente (se abre al tocar una fila del detalle de
 * categoría). Reutiliza las piezas de FormKit de AddTransactionModal. Hace la
 * llamada a la API y avisa al padre con `onSaved(respuesta, cambios)` o
 * `onDeleted(rowIndex)`; refrescar datos y el toast los gestiona el padre.
 */
export default function TransactionEditModal({ tx, emoji, onClose, onSaved, onDeleted }) {
  const hideAmounts = useHideAmounts()
  const initial = useMemo(() => draftFromTx(tx), [tx])
  const [draft, setDraft]       = useState(initial)
  const [showDate, setShowDate] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [showNewCat, setShowNewCat] = useState(false)

  const { customCategories = {} } = useSettings() || {}
  const DEFAULT_CATEGORIES = useCategories()
  const ALL_DEFAULTS = useCategories({ includeHidden: true })

  const cats = useMemo(() => {
    const list = combineCategories(DEFAULT_CATEGORIES[draft.tipo], customCategories[draft.tipo])
    // Categoría original que ya no está en la lista (antigua o "Sin categoría"):
    // se ofrece igualmente para no obligar a cambiarla al editar otra cosa.
    if (draft.tipo === initial.tipo && !list.some(c => sameName(c.concepto, initial.concepto))) {
      const orig = ALL_DEFAULTS[initial.tipo]?.find(c => sameName(c.concepto, initial.concepto))
      list.unshift({ concepto: initial.concepto, emoji: orig?.emoji || emoji || '💶', hidden: !!orig })
    }
    return list
  }, [DEFAULT_CATEGORIES, ALL_DEFAULTS, customCategories, draft.tipo, initial, emoji])

  const patch    = buildTransactionPatch(tx, draft)
  const changed  = Object.keys(patch).length > 0
  const invalid  = validateDraft(draft)
  const amtNum   = parseAmount(draft.importe)
  const amtOk    = amtNum > 0
  const canSave  = changed && !invalid && !saving

  const hoy  = todayLocal()
  const ayer = addDaysLocal(-1)
  const dateMode = draft.fecha === hoy ? 'hoy' : draft.fecha === ayer ? 'ayer' : 'otra'

  function set(field, value) {
    setDraft(d => ({ ...d, [field]: value }))
    setError(null)
  }

  function pickTipo(tipo) {
    setDraft(d => {
      const list = combineCategories(DEFAULT_CATEGORIES[tipo], customCategories[tipo])
      const keep = list.some(c => sameName(c.concepto, d.concepto)) || (tipo === initial.tipo && d.concepto === initial.concepto)
      return { ...d, tipo, concepto: keep ? d.concepto : (tipo === initial.tipo ? initial.concepto : null) }
    })
    setError(null)
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await updateTransaction(tx.rowIndex, patch)
      onSaved?.(res, patch)
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudieron guardar los cambios. Inténtalo de nuevo.'))
      setSaving(false)
    }
  }

  async function handleDelete() {
    try {
      await deleteTransaction(tx.rowIndex)
      setConfirmDel(false)
      onDeleted?.(tx.rowIndex)
    } catch (err) {
      setConfirmDel(false)
      setError(apiErrorMessage(err, 'No se pudo eliminar. Inténtalo de nuevo.'))
    }
  }

  const hint = invalid || 'Cambia algún dato para guardar'
  const when = dayLabel(initial.fecha, hoy).long

  return createPortal(
    <div className="txedit-layer">
      <FormScreen
        title="Editar movimiento"
        subtitle={`${tx.concepto} · ${when}`}
        onClose={saving ? () => {} : onClose}
        headerRight={
          <button type="button" className="fm-icon-btn" onClick={onClose} disabled={saving} aria-label="Cerrar editor">
            <Icon name="close" />
          </button>
        }
        footer={
          <>
            {error && <p className="fm-error fm-footer-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
            <PrimaryButton loading={saving} disabled={!canSave} hint={hint} onClick={handleSave}>
              Guardar cambios
            </PrimaryButton>
          </>
        }
      >
        <Field label="Importe" error={!amtOk && draft.importe !== '' ? 'Escribe un importe mayor que 0' : ''}>
          {({ id, describedBy, invalid: inv }) => (
            <AmountInput id={id} describedBy={describedBy} invalid={inv} value={draft.importe}
              placeholder="0,00" onChange={v => set('importe', v)} />
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
                  if (o.key === 'hoy') { set('fecha', hoy); setShowDate(false) }
                  else if (o.key === 'ayer') { set('fecha', ayer); setShowDate(false) }
                  else setShowDate(true)
                }}
              />
              {(showDate || dateMode === 'otra') && (
                <input id={id} className="fm-input" type="date" value={draft.fecha} max={hoy}
                  onChange={e => set('fecha', e.target.value || initial.fecha)} />
              )}
            </>
          )}
        </Field>

        <Section title="Tipo">
          <Segmented label="Tipo de movimiento" options={TIPO_OPTIONS} value={draft.tipo} onChange={pickTipo} />
        </Section>

        <Section title="Categoría">
          <NewCategoryButton onClick={() => setShowNewCat(true)} disabled={saving} />
          <div className="fm-grid fm-grid--3" role="radiogroup" aria-label="Categoría">
            {cats.map(c => {
              const sel = sameName(draft.concepto, c.concepto)
              return (
                <button key={categoryKey(draft.tipo, c.concepto)} type="button" role="radio" aria-checked={sel}
                  className={`fm-tile${sel ? ' selected' : ''}`} disabled={saving}
                  onClick={() => set('concepto', c.concepto)}>
                  <span className="fm-tile-icon">{c.emoji}</span>
                  <span className="fm-tile-label">{c.concepto}{c.hidden ? ' (oculta)' : ''}</span>
                  {sel && <span className="fm-tile-check"><Icon name="check" size={13} /></span>}
                </button>
              )
            })}
          </div>
          {!draft.concepto && (
            <p className="fm-hint">Elige una categoría de {TYPES.find(t => t.id === draft.tipo)?.label.toLowerCase()}</p>
          )}
        </Section>

        <Field label="Comentario" optional>
          {({ id }) => (
            <input id={id} className="fm-input" type="text" placeholder="Añade una nota…" value={draft.comentario}
              onChange={e => set('comentario', e.target.value)} maxLength={200} autoComplete="off" />
          )}
        </Field>

        <div className="txedit-danger">
          <DangerButton onClick={() => setConfirmDel(true)} disabled={saving}>Eliminar movimiento</DangerButton>
        </div>
      </FormScreen>

      {showNewCat && (
        <NewCategorySheet tipo={draft.tipo} existing={cats}
          onCreated={name => set('concepto', name)} onClose={() => setShowNewCat(false)} />
      )}

      {confirmDel && (
        <ConfirmSheet
          title="¿Eliminar este movimiento?"
          message={`${tx.concepto} · ${fmtAmount(Math.abs(tx.importe), hideAmounts, Number.isInteger(Math.abs(tx.importe)) ? 0 : 2)} · ${when}. No se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(false)}
        />
      )}
    </div>,
    document.body,
  )
}
