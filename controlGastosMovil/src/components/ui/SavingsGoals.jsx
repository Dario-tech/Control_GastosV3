import { useState } from 'react'
import { useSavingsGoals } from '../../hooks/useSavingsGoals'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { fmt } from '../../utils'

const GOAL_EMOJIS = ['🎯', '🏖️', '🚗', '🏠', '💍', '🎓', '✈️', '💻', '🛟', '🎁']

function GoalModal({ goal, onSave, onClose, onDelete }) {
  useLockBodyScroll()
  const [nombre, setNombre]     = useState(goal?.nombre ?? '')
  const [objetivo, setObjetivo] = useState(goal?.objetivo != null ? String(goal.objetivo) : '')
  const [ahorrado, setAhorrado] = useState(goal?.ahorrado != null ? String(goal.ahorrado) : '')
  const [fecha, setFecha]       = useState(goal?.fecha ?? '')
  const [emoji, setEmoji]       = useState(goal?.emoji ?? '🎯')

  const objetivoNum = parseFloat(String(objetivo).replace(',', '.'))
  const canSave = nombre.trim() && objetivoNum > 0

  function submit() {
    if (!canSave) return
    onSave({
      nombre:   nombre.trim(),
      objetivo: objetivoNum,
      ahorrado: parseFloat(String(ahorrado).replace(',', '.')) || 0,
      fecha:    fecha || null,
      emoji,
    })
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-sheet goal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <div className="goal-modal-title">{goal ? 'Editar meta' : 'Nueva meta de ahorro'}</div>

        <div className="goal-emoji-row">
          {GOAL_EMOJIS.map(e => (
            <button
              key={e}
              className={`goal-emoji-btn${emoji === e ? ' active' : ''}`}
              onClick={() => setEmoji(e)}
            >{e}</button>
          ))}
        </div>

        <label className="goal-field-label">Nombre</label>
        <input className="setup-input" value={nombre} onChange={e => setNombre(e.target.value)}
          placeholder="Vacaciones, coche nuevo…" maxLength={40} />

        <div className="goal-field-row">
          <div style={{ flex: 1 }}>
            <label className="goal-field-label">Objetivo (€)</label>
            <input className="setup-input" inputMode="decimal" value={objetivo}
              onChange={e => setObjetivo(e.target.value)} placeholder="5000" />
          </div>
          <div style={{ flex: 1 }}>
            <label className="goal-field-label">Ahorrado (€)</label>
            <input className="setup-input" inputMode="decimal" value={ahorrado}
              onChange={e => setAhorrado(e.target.value)} placeholder="0" />
          </div>
        </div>

        <label className="goal-field-label">Fecha objetivo (opcional)</label>
        <input className="setup-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />

        <button className="setup-btn" style={{ marginTop: 16, opacity: canSave ? 1 : 0.5 }}
          onClick={submit} disabled={!canSave}>
          {goal ? 'Guardar' : 'Crear meta'}
        </button>
        {goal && onDelete && (
          <button className="goal-delete-btn" onClick={onDelete}>Eliminar meta</button>
        )}
      </div>
    </div>
  )
}

export default function SavingsGoals() {
  const { goals, addGoal, updateGoal, removeGoal } = useSavingsGoals()
  const [showModal, setShowModal] = useState(false)
  const [editGoal, setEditGoal]   = useState(null)

  function openAdd()      { setEditGoal(null); setShowModal(true) }
  function openEdit(g)    { setEditGoal(g);    setShowModal(true) }
  function close()        { setShowModal(false); setEditGoal(null) }

  function handleSave(data) {
    if (editGoal) updateGoal(editGoal.id, data)
    else          addGoal(data)
    close()
  }
  function handleDelete() {
    if (editGoal) removeGoal(editGoal.id)
    close()
  }

  return (
    <div className="goals-section">
      <div className="goals-header">
        <span className="goals-title">🎯 Metas de ahorro</span>
        <button className="goals-add-btn" onClick={openAdd}>+ Añadir</button>
      </div>

      {goals.length === 0 ? (
        <p className="goals-empty">Crea una meta y sigue tu progreso hacia ella.</p>
      ) : (
        <div className="goals-list">
          {goals.map(g => {
            const pct = g.objetivo > 0 ? Math.min(100, (g.ahorrado / g.objetivo) * 100) : 0
            const done = g.ahorrado >= g.objetivo
            return (
              <div key={g.id} className="goal-item" onClick={() => openEdit(g)}>
                <div className="goal-item-top">
                  <span className="goal-item-name">{g.emoji} {g.nombre}</span>
                  <span className="goal-item-amount">{fmt(g.ahorrado)} / {fmt(g.objetivo)}</span>
                </div>
                <div className="goal-bar-bg">
                  <div className="goal-bar-fill" style={{
                    width: `${pct}%`,
                    background: done ? 'var(--green, #2dd4a0)' : 'var(--accent)',
                  }} />
                </div>
                <div className="goal-item-foot">
                  <span className="goal-pct">{done ? '¡Completada! 🎉' : `${Math.round(pct)}%`}</span>
                  {g.fecha && <span className="goal-date">para {g.fecha}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <GoalModal
          goal={editGoal}
          onSave={handleSave}
          onClose={close}
          onDelete={editGoal ? handleDelete : null}
        />
      )}
    </div>
  )
}
