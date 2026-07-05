import { useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useSettings } from '../../context/SettingsContext'
import { postTransaction } from '../../services/api'
import { TYPES, DEFAULT_CATEGORIES } from '../../data/categories'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function AddTransactionModal({ onClose }) {
  const [step, setStep]       = useState(1)
  const [tipo, setTipo]       = useState(null)
  const [concepto, setConcepto] = useState(null)
  const [importe, setImporte] = useState('')
  const [fecha, setFecha]     = useState(today())
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const { refresh }           = useFinanceData()
  const { customCategories }  = useSettings()

  function handleType(t) { setTipo(t); setConcepto(null); setStep(2) }

  async function handleSubmit(cat) {
    const amt = parseFloat(String(importe).replace(',', '.'))
    if (!amt || amt <= 0) { setError('Introduce un importe válido'); return }
    setLoading(true)
    setError(null)
    try {
      await postTransaction(amt, tipo, cat, fecha)
      refresh()
      onClose()
    } catch {
      setError('Error al guardar. Inténtalo de nuevo.')
      setLoading(false)
    }
  }

  const allCats = tipo ? [...DEFAULT_CATEGORIES[tipo], ...(customCategories[tipo] || [])] : []

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-sheet add-tx-sheet">
        <div className="modal-handle" />

        <div className="add-tx-header">
          <span className="add-tx-title">
            {step === 1 ? 'Nuevo movimiento' : tipo}
          </span>
          <button className="modal-close-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {step === 1 && (
          <div className="catmodal-types" style={{ marginTop: 8 }}>
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
          <>
            <div className="add-tx-fields">
              <div className="add-tx-field-row">
                <div className="modal-field" style={{ flex: 1 }}>
                  <label className="modal-label">Importe (€)</label>
                  <div className="modal-input-wrap">
                    <span className="modal-input-prefix">€</span>
                    <input
                      className="modal-input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="0,00"
                      value={importe}
                      onChange={e => { setImporte(e.target.value); setError(null) }}
                      autoFocus
                    />
                  </div>
                </div>
                <div className="modal-field">
                  <label className="modal-label">Fecha</label>
                  <div className="modal-input-wrap">
                    <input
                      className="modal-input"
                      type="date"
                      value={fecha}
                      max={today()}
                      onChange={e => setFecha(e.target.value)}
                      style={{ minWidth: 130 }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <p className="modal-label" style={{ marginBottom: 10, marginTop: 4 }}>Categoría</p>
            <div className="catmodal-grid">
              {allCats.map(c => (
                <button key={c.concepto} className="catmodal-cat-card"
                  disabled={loading}
                  onClick={() => handleSubmit(c.concepto)}>
                  <span className="catmodal-cat-emoji">{c.emoji}</span>
                  <span className="catmodal-cat-label">{c.concepto}</span>
                </button>
              ))}
            </div>

            {error && <p className="catmodal-error" style={{ marginTop: 12 }}>{error}</p>}

            <div className="catmodal-footer" style={{ marginTop: 16 }}>
              <button className="catmodal-back" onClick={() => setStep(1)}>← Cambiar tipo</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
