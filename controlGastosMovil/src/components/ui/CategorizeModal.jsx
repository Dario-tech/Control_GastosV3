import { useEffect, useRef, useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useSettings } from '../../context/SettingsContext'
import { TYPES } from '../../data/categories'
import { useCategories } from '../../hooks/useCategories'
import { isUnusualAmount, fmt } from '../../utils'
import { useFocusTrap, ConfirmSheet } from './FormKit'

const DATE_FMT = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

function formatDate(dateStr) {
  try { return DATE_FMT.format(new Date(dateStr + 'T12:00:00')) } catch { return dateStr }
}

// Texto de la etiqueta de sugerencia según de dónde salga: regla aprendida para
// ese comercio, o adivinada por el historial (importe/fecha parecidos).
export function suggestionBadge(suggested, comercio) {
  if (suggested?.origen === 'comercio' && comercio) return `✨ Como la última vez en ${comercio}`
  return '✨ Sugerido'
}

/* variant="received": hoja "Gasto recibido" que se abre al llegar un pago del
   Atajo de iOS. Con sugerencia, la muestra ya elegida con "Guardar" y
   "Cambiar categoría" (que lleva a la misma rejilla que la campana). */
export default function CategorizeModal({ pending, total, onCategorize, onSkip, onDiscard, variant = 'queue' }) {
  const received = variant === 'received'
  const [changing, setChanging] = useState(false)
  const [step, setStep]       = useState(1)
  const [tipo, setTipo]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [recordar, setRecordar] = useState(true)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const { refresh, data }     = useFinanceData()
  const { customCategories }  = useSettings()
  const DEFAULT_CATEGORIES = useCategories()
  const ref = useRef(null)
  useFocusTrap(ref)

  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true })
  }, [])

  // Cada pendiente nuevo de la cola empieza con "recordar" activado.
  useEffect(() => { setRecordar(true); setError(null); setChanging(false) }, [pending.id])

  const comercio = typeof pending.comercio === 'string' && pending.comercio.trim() ? pending.comercio.trim() : null
  const importeLabel = fmt(pending.importe, 2)

  function handleType(t) { setTipo(t); setStep(2) }

  async function saveCategory(tipoValue, concepto) {
    setLoading(true)
    setError(null)
    try {
      await onCategorize(pending.id, tipoValue, concepto, { recordar })
      refresh()
      setStep(1)
      setTipo(null)
    } catch {
      setError('Error al guardar. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const handleConcepto = concepto => saveCategory(tipo, concepto)

  async function discard() {
    setError(null)
    try {
      await onDiscard(pending.id)
      setStep(1)
      setTipo(null)
      refresh()
    } catch {
      setError('No se pudo descartar. Inténtalo de nuevo.')
    } finally {
      setConfirmDiscard(false)
    }
  }

  const allCats = tipo ? [...DEFAULT_CATEGORIES[tipo], ...(customCategories[tipo] || [])] : []

  // Emoji de la categoría sugerida, buscándolo en las categorías del usuario
  const suggested = pending.suggested
  const suggestedEmoji = suggested
    ? ([...(DEFAULT_CATEGORIES[suggested.tipo] || []), ...(customCategories[suggested.tipo] || [])]
        .find(c => c.concepto === suggested.concepto)?.emoji || '✨')
    : null
  const quick = received && suggested && !changing && step === 1

  const title = received
    ? `Gasto recibido${comercio ? ` en ${comercio}` : ''}`
    : (comercio ? `Pago pendiente en ${comercio}` : 'Pago pendiente')

  return (
    <div className="catmodal-overlay">
      <div className="catmodal" role="dialog" aria-modal="true" ref={ref} tabIndex={-1}
        aria-label={title}>
        <div className="catmodal-counter">
          {received ? 'Gasto recibido' : total > 1 ? `Quedan ${total} pagos por categorizar` : 'Pago pendiente'}
        </div>
        {comercio && <h2 className="catmodal-merchant">{comercio}</h2>}
        <div className="catmodal-amount">{importeLabel}</div>
        <div className="catmodal-date">{formatDate(pending.fecha)}</div>
        <p className="catmodal-subtitle">
          {quick ? 'Categoría' : step === 1 ? '¿Qué tipo de movimiento es?' : `${tipo} — ¿qué concepto?`}
        </p>

        {quick && (
          <>
            <div className="catmodal-suggested selected" role="group" aria-label={`Categoría elegida: ${suggested.concepto}`}>
              <span className="catmodal-suggested-badge">{suggestionBadge(suggested, comercio)}</span>
              <span className="catmodal-suggested-cat">
                <span className="catmodal-suggested-emoji" aria-hidden="true">{suggestedEmoji}</span>
                {suggested.concepto}
              </span>
              <span className="catmodal-suggested-tipo">{suggested.tipo}</span>
            </div>
            <button type="button" className="catmodal-save" onClick={() => saveCategory(suggested.tipo, suggested.concepto)}
              disabled={loading} aria-busy={loading || undefined}>
              {loading ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="catmodal-change" onClick={() => setChanging(true)} disabled={loading}>
              Cambiar categoría
            </button>
          </>
        )}

        {!received && step === 1 && suggested && (
          <button
            className="catmodal-suggested"
            onClick={() => saveCategory(suggested.tipo, suggested.concepto)}
            disabled={loading}
          >
            <span className="catmodal-suggested-badge">{suggestionBadge(suggested, comercio)}</span>
            <span className="catmodal-suggested-cat">
              <span className="catmodal-suggested-emoji">{suggestedEmoji}</span>
              {suggested.concepto}
            </span>
            <span className="catmodal-suggested-tipo">{suggested.tipo}</span>
          </button>
        )}

        {step === 1 && !quick && (
          <div className="catmodal-types">
            {TYPES.map(t => (
              <button key={t.id} className="catmodal-type-card"
                onClick={() => handleType(t.id)} style={{ '--card-color': t.color }}>
                <span className="catmodal-type-emoji">{t.emoji}</span>
                <span className="catmodal-type-label">{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="catmodal-grid">
            {allCats.map(c => {
              const unusual = isUnusualAmount(data, c.concepto, pending.importe)
              return (
                <button key={c.concepto} className={`catmodal-cat-card${unusual ? ' unusual' : ''}`}
                  onClick={() => handleConcepto(c.concepto)} disabled={loading}
                  title={unusual ? `${unusual.ratio}× tu gasto medio en ${c.concepto}` : undefined}>
                  {unusual && <span className="catmodal-cat-warn">⚠️</span>}
                  <span className="catmodal-cat-emoji">{c.emoji}</span>
                  <span className="catmodal-cat-label">{c.concepto}</span>
                </button>
              )
            })}
          </div>
        )}

        {comercio && (
          <label className="catmodal-remember">
            <input type="checkbox" checked={recordar} onChange={e => setRecordar(e.target.checked)} />
            <span>Recordar para este comercio</span>
          </label>
        )}

        {error && <p className="catmodal-error" role="alert">{error}</p>}

        <div className="catmodal-footer">
          {step === 2 && (
            <button className="catmodal-back" onClick={() => setStep(1)}>← Cambiar tipo</button>
          )}
          {step === 1 && received && changing && suggested && (
            <button className="catmodal-back" onClick={() => setChanging(false)}>← Sugerencia</button>
          )}
          {step === 1 && onDiscard && (
            <button className="catmodal-discard" onClick={() => setConfirmDiscard(true)} disabled={loading}>Descartar</button>
          )}
          <button className="catmodal-cancel" onClick={onSkip}>Dejar para luego</button>
        </div>
      </div>
      {confirmDiscard && (
        <ConfirmSheet
          title="¿Descartar este pago?"
          message={`${comercio ? `${comercio} · ` : ''}${importeLabel}. No se apuntará en tus movimientos. Úsalo para pagos rechazados o repetidos.`}
          confirmLabel="Descartar"
          onConfirm={discard}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  )
}
