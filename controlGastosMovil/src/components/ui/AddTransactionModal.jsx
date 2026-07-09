import { useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useSettings } from '../../context/SettingsContext'
import { postTransaction } from '../../services/api'
import { TYPES, EMOJI_SUGGESTIONS } from '../../data/categories'
import { useCategories } from '../../hooks/useCategories'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function AddTransactionModal({ onClose }) {
  const [step, setStep]         = useState(1)
  const [tipo, setTipo]         = useState(null)
  const [importe, setImporte]   = useState('')
  const [fecha, setFecha]       = useState(today())
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  // Inline new-category form
  const [showNewCat, setShowNewCat] = useState(false)
  const [newEmoji, setNewEmoji]     = useState('💶')
  const [newName, setNewName]       = useState('')
  const [newCatErr, setNewCatErr]   = useState('')

  const { refresh }          = useFinanceData()
  const { customCategories, addCategory } = useSettings()
  const DEFAULT_CATEGORIES = useCategories()

  function handleType(t) { setTipo(t); setStep(2); setShowNewCat(false) }

  async function handleSubmit(concepto) {
    const amt = parseFloat(String(importe).replace(',', '.'))
    if (!amt || amt <= 0) { setError('Introduce un importe válido'); return }
    setLoading(true)
    setError(null)
    try {
      await postTransaction(amt, tipo, concepto, fecha)
      refresh()
      onClose()
    } catch {
      setError('Error al guardar. Inténtalo de nuevo.')
      setLoading(false)
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
            {/* Importe + fecha */}
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

            {/* Category grid */}
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

              {/* + Nueva categoría */}
              {!showNewCat && (
                <button className="catmodal-cat-card cat-new-card"
                  onClick={() => setShowNewCat(true)}>
                  <span className="catmodal-cat-emoji">＋</span>
                  <span className="catmodal-cat-label">Nueva</span>
                </button>
              )}
            </div>

            {/* Inline new-category form */}
            {showNewCat && (
              <div className="cat-inline-form">
                <div className="cat-emoji-scroll">
                  {EMOJI_SUGGESTIONS.map(e => (
                    <button key={e} className={`cat-emoji-btn${newEmoji === e ? ' active' : ''}`}
                      onClick={() => setNewEmoji(e)}>{e}</button>
                  ))}
                </div>
                <div className="cat-add-input-row">
                  <span className="cat-selected-emoji">{newEmoji}</span>
                  <input
                    className="cat-name-input"
                    placeholder="Nombre de la categoría"
                    value={newName}
                    onChange={e => { setNewName(e.target.value); setNewCatErr('') }}
                    onKeyDown={e => e.key === 'Enter' && handleAddNewCat()}
                    maxLength={32}
                    autoFocus
                  />
                  <button className="cat-add-btn" onClick={handleAddNewCat}>Añadir</button>
                </div>
                {newCatErr && <p className="cat-err">{newCatErr}</p>}
                <button className="catmodal-back" style={{ marginTop: 6 }}
                  onClick={() => { setShowNewCat(false); setNewName(''); setNewCatErr('') }}>
                  Cancelar
                </button>
              </div>
            )}

            {error && <p className="catmodal-error" style={{ marginTop: 12 }}>{error}</p>}

            <div className="catmodal-footer" style={{ marginTop: 16 }}>
              <button className="catmodal-back" onClick={() => { setStep(1); setShowNewCat(false) }}>
                ← Cambiar tipo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
