import { useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useSettings } from '../../context/SettingsContext'
import { postTransaction, suggestEmoji } from '../../services/api'
import { TYPES, EMOJI_SUGGESTIONS } from '../../data/categories'
import { isUnusualAmount, fmt } from '../../utils'
import { FormScreen, Field, Section, AmountInput, Chips, PrimaryButton, Icon } from './FormKit'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { useCategories } from '../../hooks/useCategories'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function AddTransactionModal({ onClose }) {
  useLockBodyScroll()
  const [step, setStep]         = useState(1)
  const [selected, setSelected] = useState(null)
  const [showDate, setShowDate] = useState(false)
  const [tipo, setTipo]         = useState(null)
  const [importe, setImporte]   = useState('')
  const [fecha, setFecha]       = useState(today())
  const [comentario, setComentario] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  // Inline new-category form
  const [showNewCat, setShowNewCat] = useState(false)
  const [newEmoji, setNewEmoji]     = useState('💶')
  const [newName, setNewName]       = useState('')
  const [newCatErr, setNewCatErr]   = useState('')
  const [suggesting, setSuggesting] = useState(false)

  const { refresh, data }    = useFinanceData()
  const { customCategories, addCategory } = useSettings()
  const DEFAULT_CATEGORIES = useCategories()

  function handleType(t) { setTipo(t); setStep(2); setShowNewCat(false) }

  async function handleSubmit(concepto) {
    const amt = parseFloat(String(importe).replace(',', '.'))
    if (!amt || amt <= 0) { setError('Introduce un importe válido'); return }
    setLoading(true)
    setError(null)
    try {
      await postTransaction(amt, tipo, concepto, fecha, comentario.trim() || null)
      refresh()
      onClose()
    } catch (err) {
      setError(
        err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? 'El servidor está despertando, puede tardar unos segundos. Vuelve a intentarlo.'
          : 'Error al guardar. Inténtalo de nuevo.'
      )
      setLoading(false)
    }
  }

  async function handleSuggestEmoji() {
    const name = newName.trim()
    if (!name || suggesting) return
    setSuggesting(true)
    try {
      const { emoji } = await suggestEmoji(name)
      setNewEmoji(emoji)
    } catch {
      // silencioso: el usuario sigue pudiendo elegir emoji a mano
    } finally {
      setSuggesting(false)
    }
  }

  function handleAddNewCat() {
    const name = newName.trim()
    if (!name) { setNewCatErr('Escribe un nombre'); return }
    addCategory(tipo, { concepto: name, emoji: newEmoji })
    setShowNewCat(false)
    setNewName('')
    setNewCatErr('')
    handleSubmit(name)
  }

  const allCats = tipo ? [...DEFAULT_CATEGORIES[tipo], ...(customCategories[tipo] || [])] : []
  const amtNum = parseFloat(String(importe).replace(',', '.'))
  const amtOk  = amtNum > 0
  const hoy    = today()
  const ayer   = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const dateMode = fecha === hoy ? 'hoy' : fecha === ayer ? 'ayer' : 'otra'
  const unusualSel = selected && amtOk ? isUnusualAmount(data, selected, amtNum) : null
  const tipoMeta = TYPES.find(t => t.id === tipo)
  const canSave = !!selected && amtOk && !loading
  const missing = !amtOk ? 'Escribe un importe para continuar' : 'Elige una categoría para continuar'

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
            {amtOk ? `Guardar ${fmt(amtNum, Number.isInteger(amtNum) ? 0 : 2)}` : 'Guardar movimiento'}
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
            <div className="fm-grid fm-grid--3" role="radiogroup" aria-label="Categoría">
              {allCats.map(c => {
                const unusual = amtOk ? isUnusualAmount(data, c.concepto, amtNum) : null
                const sel = selected === c.concepto
                return (
                  <button key={c.concepto} type="button" role="radio" aria-checked={sel}
                    className={`fm-tile${sel ? ' selected' : ''}`}
                    disabled={loading}
                    onClick={() => { setSelected(c.concepto); setShowNewCat(false); setError(null) }}>
                    {unusual && <span className="fm-tile-warn" aria-label="Importe inusual">⚠️</span>}
                    <span className="fm-tile-icon">{c.emoji}</span>
                    <span className="fm-tile-label">{c.concepto}</span>
                    {sel && <span className="fm-tile-check"><Icon name="check" size={13} /></span>}
                  </button>
                )
              })}
              {!showNewCat && (
                <button type="button" className="fm-tile fm-tile--new" onClick={() => setShowNewCat(true)}>
                  <span className="fm-tile-icon">＋</span>
                  <span className="fm-tile-label">Nueva</span>
                </button>
              )}
            </div>
            {unusualSel && (
              <p className="fm-warn"><span aria-hidden="true">⚠️</span>{unusualSel.ratio}× tu gasto medio en {selected}</p>
            )}
          </Section>

          {showNewCat && (
            <div className="fm-card fm-newcat">
              <span className="fm-label">Nueva categoría</span>
              <div className="fm-emoji-scroll" role="radiogroup" aria-label="Emoji">
                {EMOJI_SUGGESTIONS.map(e => (
                  <button key={e} type="button" role="radio" aria-checked={newEmoji === e}
                    className={`fm-emoji${newEmoji === e ? ' selected' : ''}`} onClick={() => setNewEmoji(e)}>{e}</button>
                ))}
              </div>
              <div className="fm-newcat-row">
                <span className="fm-newcat-emoji" aria-hidden="true">{newEmoji}</span>
                <input className="fm-input" placeholder="Nombre de la categoría" value={newName} maxLength={32}
                  aria-invalid={!!newCatErr || undefined} aria-label="Nombre de la categoría"
                  onChange={e => { setNewName(e.target.value); setNewCatErr('') }}
                  onKeyDown={e => e.key === 'Enter' && handleAddNewCat()} autoFocus />
                <button type="button" className="fm-icon-btn" onClick={handleSuggestEmoji}
                  disabled={!newName.trim() || suggesting} aria-label="Sugerir emoji con IA" title="Sugerir emoji con IA">
                  {suggesting ? <span className="fm-spinner" aria-hidden="true" /> : '✨'}
                </button>
              </div>
              {newCatErr && <p className="fm-error" role="alert"><Icon name="alert" size={15} />{newCatErr}</p>}
              <div className="fm-sheet-actions">
                <button type="button" className="fm-secondary" onClick={() => { setShowNewCat(false); setNewName(''); setNewCatErr('') }}>Cancelar</button>
                <button type="button" className="fm-confirm" onClick={handleAddNewCat} disabled={loading}>
                  <span>Añadir y guardar</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </FormScreen>
  )
}
