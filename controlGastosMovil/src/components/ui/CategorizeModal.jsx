import { useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useSettings } from '../../context/SettingsContext'
import { TYPES } from '../../data/categories'
import { useCategories } from '../../hooks/useCategories'
import { isUnusualAmount } from '../../utils'

const DATE_FMT = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

function formatDate(dateStr) {
  try { return DATE_FMT.format(new Date(dateStr + 'T12:00:00')) } catch { return dateStr }
}

export default function CategorizeModal({ pending, total, onCategorize, onSkip }) {
  const [step, setStep]       = useState(1)
  const [tipo, setTipo]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const { refresh, data }     = useFinanceData()
  const { customCategories }  = useSettings()
  const DEFAULT_CATEGORIES = useCategories()

  const fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(pending.importe)

  function handleType(t) { setTipo(t); setStep(2) }

  async function saveCategory(tipoValue, concepto) {
    setLoading(true)
    setError(null)
    try {
      await onCategorize(pending.id, tipoValue, concepto)
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

  const allCats = tipo ? [...DEFAULT_CATEGORIES[tipo], ...(customCategories[tipo] || [])] : []

  // Emoji de la categoría sugerida, buscándolo en las categorías del usuario
  const suggested = pending.suggested
  const suggestedEmoji = suggested
    ? ([...(DEFAULT_CATEGORIES[suggested.tipo] || []), ...(customCategories[suggested.tipo] || [])]
        .find(c => c.concepto === suggested.concepto)?.emoji || '✨')
    : null

  return (
    <div className="catmodal-overlay">
      <div className="catmodal">
        <div className="catmodal-counter">{total > 1 ? `Quedan ${total} pagos por categorizar` : 'Pago pendiente'}</div>
        <div className="catmodal-date">{formatDate(pending.fecha)}</div>
        <div className="catmodal-amount">{fmt}</div>
        <p className="catmodal-subtitle">
          {step === 1 ? '¿Qué tipo de movimiento es?' : `${tipo} — ¿qué concepto?`}
        </p>

        {step === 1 && suggested && (
          <button
            className="catmodal-suggested"
            onClick={() => saveCategory(suggested.tipo, suggested.concepto)}
            disabled={loading}
          >
            <span className="catmodal-suggested-badge">✨ Sugerido</span>
            <span className="catmodal-suggested-cat">
              <span className="catmodal-suggested-emoji">{suggestedEmoji}</span>
              {suggested.concepto}
            </span>
            <span className="catmodal-suggested-tipo">{suggested.tipo}</span>
          </button>
        )}

        {step === 1 && (
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

        {error && <p className="catmodal-error">{error}</p>}

        <div className="catmodal-footer">
          {step === 2 && (
            <button className="catmodal-back" onClick={() => setStep(1)}>← Cambiar tipo</button>
          )}
          <button className="catmodal-cancel" onClick={onSkip}>Dejar para luego</button>
        </div>
      </div>
    </div>
  )
}
