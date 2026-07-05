import { useState } from 'react'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { BUDGET_COLORS } from '../../hooks/useBudget'
import { DEFAULT_CATEGORIES } from '../../data/categories'
import { useSettings } from '../../context/SettingsContext'

const TIPOS = [
  { id: 'Gasto Variable', label: 'Variable' },
  { id: 'Gasto Fijo',     label: 'Fijo' },
]

function inferTipo(name) {
  if (!name) return 'Gasto Variable'
  for (const tipo of ['Gasto Variable', 'Gasto Fijo']) {
    if (DEFAULT_CATEGORIES[tipo].some(c => c.concepto === name)) return tipo
  }
  return 'Gasto Variable'
}

export default function BudgetModal({ item, onSave, onClose, onDelete }) {
  useLockBodyScroll()
  const isEdit = !!item
  const { customCategories } = useSettings()

  const [tipo, setTipo]           = useState(item?.tipo || inferTipo(item?.name))
  const [selectedCat, setSelectedCat] = useState(
    item ? { concepto: item.name, emoji: item.emoji } : null
  )
  const [limit, setLimit] = useState(item?.limit != null ? item.limit.toString() : '')
  const [color, setColor] = useState(item?.color || BUDGET_COLORS[0])

  const allCats = [...DEFAULT_CATEGORIES[tipo], ...(customCategories[tipo] || [])]
  const canSave = selectedCat && limit && parseFloat(limit) > 0

  function handleTipoChange(t) {
    setTipo(t)
    setSelectedCat(null)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!canSave) return
    onSave({
      emoji: selectedCat.emoji,
      name:  selectedCat.concepto,
      limit: parseFloat(limit) || 0,
      color,
      tipo,
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />

        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Editar categoría' : 'Nueva categoría'}</span>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Tipo selector */}
        <div className="bgt-tipo-segmented">
          {TIPOS.map(t => (
            <button
              key={t.id}
              type="button"
              className={`bgt-tipo-btn${tipo === t.id ? ' active' : ''}`}
              onClick={() => handleTipoChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Category grid */}
        <div className="modal-label" style={{ marginBottom: 10 }}>Categoría</div>
        <div className="catmodal-grid bgt-cat-grid">
          {allCats.map(c => (
            <button
              key={c.concepto}
              type="button"
              className={`catmodal-cat-card${selectedCat?.concepto === c.concepto ? ' selected' : ''}`}
              onClick={() => setSelectedCat(c)}
            >
              <span className="catmodal-cat-emoji">{c.emoji}</span>
              <span className="catmodal-cat-label">{c.concepto}</span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="modal-form" style={{ marginTop: 16 }}>
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

          <div className="modal-field">
            <label className="modal-label">Color de la barra</label>
            <div className="modal-color-row">
              {BUDGET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`modal-color-dot${color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div className="modal-bar-preview">
              <div className="modal-bar-preview-fill" style={{ background: color, width: '60%' }} />
            </div>
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
