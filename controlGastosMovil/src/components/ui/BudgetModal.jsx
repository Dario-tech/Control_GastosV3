import { useState } from 'react'

const QUICK_EMOJIS = [
  '🏃','🍽️','🏠','🚗','💊','✈️','🛍️','📱','🎉','☕',
  '🎮','📚','🐶','👗','💇','🎬','🏋️','🎵','🍺','⚽',
  '🏥','🧴','🎁','🍕','🚌','💈','🏖️','🧹',
]

export default function BudgetModal({ item, onSave, onClose, onDelete }) {
  const isEdit = !!item
  const [emoji, setEmoji] = useState(item?.emoji || '💰')
  const [name,  setName]  = useState(item?.name  || '')
  const [limit, setLimit] = useState(item?.limit != null ? item.limit.toString() : '')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !limit) return
    onSave({ emoji, name: name.trim(), limit: parseFloat(limit) || 0 })
  }

  const canSave = name.trim() && limit && parseFloat(limit) > 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />

        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Editar categoría' : 'Nueva categoría'}</span>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-emoji-scroll">
          {QUICK_EMOJIS.map(e => (
            <button
              key={e}
              type="button"
              className={`modal-emoji-btn ${emoji === e ? 'active' : ''}`}
              onClick={() => setEmoji(e)}
            >
              {e}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-field">
            <label className="modal-label">Nombre de la categoría</label>
            <div className="modal-input-wrap">
              <span className="modal-input-prefix">{emoji}</span>
              <input
                className="modal-input"
                placeholder="ej. Ocio"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                maxLength={32}
              />
            </div>
          </div>

          <div className="modal-field">
            <label className="modal-label">Límite mensual</label>
            <div className="modal-input-wrap">
              <span className="modal-input-prefix">€</span>
              <input
                className="modal-input"
                type="number"
                inputMode="decimal"
                placeholder="0"
                min="0"
                step="0.01"
                value={limit}
                onChange={e => setLimit(e.target.value)}
              />
            </div>
            <span className="modal-field-hint">
              El gasto real se obtiene automáticamente de tus transacciones
            </span>
          </div>

          <div className="modal-actions">
            {onDelete && (
              <button type="button" className="modal-delete-btn" onClick={onDelete}>
                Eliminar
              </button>
            )}
            <button type="submit" className="modal-save-btn" disabled={!canSave}>
              {isEdit ? 'Guardar' : 'Añadir'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
