import { useState } from 'react'
import { postTransaction } from '../../services/api'
import { useFinanceData } from '../../context/FinanceDataContext'

const TYPES = [
  { id: 'Gasto Variable', label: 'Gasto Variable', emoji: '🛍️', color: 'var(--red)' },
  { id: 'Gasto Fijo',     label: 'Gasto Fijo',     emoji: '🏠', color: 'var(--orange)' },
  { id: 'Ingreso',        label: 'Ingreso',         emoji: '💼', color: 'var(--green)' },
]

const SUBCATEGORIES = {
  'Gasto Variable': [
    { concepto: 'Ocio',                 emoji: '🎉' },
    { concepto: 'Comida',               emoji: '🍽️' },
    { concepto: 'Ropa',                 emoji: '👗' },
    { concepto: 'Vuelos',               emoji: '✈️' },
    { concepto: 'Gimnasio',             emoji: '💪' },
    { concepto: 'Netflix&Dazn&Regalos', emoji: '📺' },
    { concepto: 'Variado',              emoji: '💶' },
  ],
  'Gasto Fijo': [
    { concepto: 'Piso',        emoji: '🏠' },
    { concepto: 'Luz',         emoji: '⚡' },
    { concepto: 'Gas',         emoji: '🔥' },
    { concepto: 'Agua',        emoji: '🚿' },
    { concepto: 'Wifi',        emoji: '📡' },
    { concepto: 'Transporte',  emoji: '🚇' },
    { concepto: 'Inversiones', emoji: '📈' },
    { concepto: 'Cripto',      emoji: '₿'  },
  ],
  'Ingreso': [
    { concepto: 'Nómina',        emoji: '💼' },
    { concepto: 'Otros motivos', emoji: '🎁' },
  ],
}

export default function CategorizeModal({ amount, onClose, onDone }) {
  const [step, setStep]       = useState(1)
  const [tipo, setTipo]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const { refresh }           = useFinanceData()

  const fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(amount)

  function handleType(t) {
    setTipo(t)
    setStep(2)
  }

  async function handleConcepto(concepto) {
    setLoading(true)
    setError(null)
    try {
      await postTransaction(amount, tipo, concepto)
      refresh()
      onDone()
    } catch (e) {
      setError('Error al guardar. Inténtalo de nuevo.')
      setLoading(false)
    }
  }

  return (
    <div className="catmodal-overlay">
      <div className="catmodal">
        <div className="catmodal-amount">{fmt}</div>
        <p className="catmodal-subtitle">
          {step === 1 ? '¿Qué tipo de movimiento es?' : `${tipo} — ¿qué concepto?`}
        </p>

        {step === 1 && (
          <div className="catmodal-types">
            {TYPES.map(t => (
              <button key={t.id} className="catmodal-type-card" onClick={() => handleType(t.id)}
                style={{ '--card-color': t.color }}>
                <span className="catmodal-type-emoji">{t.emoji}</span>
                <span className="catmodal-type-label">{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="catmodal-grid">
            {SUBCATEGORIES[tipo].map(c => (
              <button key={c.concepto} className="catmodal-cat-card"
                onClick={() => handleConcepto(c.concepto)} disabled={loading}>
                <span className="catmodal-cat-emoji">{c.emoji}</span>
                <span className="catmodal-cat-label">{c.concepto}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p className="catmodal-error">{error}</p>}

        <div className="catmodal-footer">
          {step === 2 && (
            <button className="catmodal-back" onClick={() => setStep(1)}>← Cambiar tipo</button>
          )}
          <button className="catmodal-cancel" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
