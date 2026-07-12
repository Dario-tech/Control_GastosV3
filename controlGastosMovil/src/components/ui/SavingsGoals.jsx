import { useState } from 'react'
import { useSavingsGoals } from '../../hooks/useSavingsGoals'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { useAuth } from '../../context/AuthContext'
import { fmt } from '../../utils'

const GOAL_EMOJIS = ['🎯', '🏖️', '🚗', '🏠', '💍', '🎓', '✈️', '💻', '🛟', '🎁']

function formatContribDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}

function GoalIcon({ goal, className }) {
  if (goal.imagen_url) return <img className={className} src={goal.imagen_url} alt={goal.nombre} />
  return <span className={className}>{goal.emoji}</span>
}

function GoalFormModal({ goal, onSave, onClose }) {
  useLockBodyScroll()
  const [nombre, setNombre]         = useState(goal?.nombre ?? '')
  const [objetivo, setObjetivo]     = useState(goal?.objetivo != null ? String(goal.objetivo) : '')
  const [fecha, setFecha]           = useState(goal?.fecha ?? '')
  const [emoji, setEmoji]           = useState(goal?.emoji ?? '🎯')
  const [imagenUrl, setImagenUrl]   = useState(goal?.imagen_url ?? '')
  const [useGif, setUseGif]         = useState(Boolean(goal?.imagen_url))
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  const objetivoNum = parseFloat(String(objetivo).replace(',', '.'))
  const canSave = nombre.trim() && objetivoNum > 0 && !saving

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      await onSave({
        nombre: nombre.trim(), objetivo: objetivoNum, fecha: fecha || null, emoji,
        imagen_url: useGif ? (imagenUrl.trim() || null) : null,
      })
    } catch (e) {
      setError(e.message || 'No se pudo guardar')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-sheet goal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <div className="goal-modal-title">{goal ? 'Editar meta' : 'Nueva meta de ahorro'}</div>

        <div className="goal-icon-toggle">
          <button className={`goal-icon-toggle-btn${!useGif ? ' active' : ''}`} onClick={() => setUseGif(false)}>
            Emoji
          </button>
          <button className={`goal-icon-toggle-btn${useGif ? ' active' : ''}`} onClick={() => setUseGif(true)}>
            GIF / imagen
          </button>
        </div>

        {!useGif ? (
          <div className="goal-emoji-row">
            {GOAL_EMOJIS.map(e => (
              <button
                key={e}
                className={`goal-emoji-btn${emoji === e ? ' active' : ''}`}
                onClick={() => setEmoji(e)}
              >{e}</button>
            ))}
          </div>
        ) : (
          <div className="goal-gif-picker">
            <input className="setup-input" value={imagenUrl} onChange={e => setImagenUrl(e.target.value)}
              placeholder="Pega la URL de un GIF o imagen (https://…)" />
            {imagenUrl.trim() && (
              <img className="goal-gif-preview" src={imagenUrl.trim()} alt="Vista previa" />
            )}
          </div>
        )}

        <label className="goal-field-label">Nombre</label>
        <input className="setup-input" value={nombre} onChange={e => setNombre(e.target.value)}
          placeholder="Vacaciones, coche nuevo…" maxLength={40} />

        <label className="goal-field-label">Objetivo (€)</label>
        <input className="setup-input" inputMode="decimal" value={objetivo}
          onChange={e => setObjetivo(e.target.value)} placeholder="5000" />

        <label className="goal-field-label">Fecha objetivo (opcional)</label>
        <input className="setup-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />

        {error && <p className="cat-err" style={{ marginTop: 8 }}>{error}</p>}

        <button className="setup-btn" style={{ marginTop: 16, opacity: canSave ? 1 : 0.5 }}
          onClick={submit} disabled={!canSave}>
          {saving ? 'Guardando…' : (goal ? 'Guardar' : 'Crear meta')}
        </button>
      </div>
    </div>
  )
}

function AddMoneyRow({ onAdd }) {
  const [value, setValue] = useState('')
  const [busy, setBusy]   = useState(false)
  const amt = parseFloat(String(value).replace(',', '.'))
  const canAdd = amt > 0 && !busy

  async function submit() {
    if (!canAdd) return
    setBusy(true)
    try {
      await onAdd(amt)
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="goal-addmoney-row">
      <span className="goal-addmoney-prefix">+€</span>
      <input
        className="goal-addmoney-input"
        inputMode="decimal"
        placeholder="Añadir dinero…"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
      />
      <button className="goal-addmoney-btn" onClick={submit} disabled={!canAdd}>
        {busy ? '…' : 'Añadir'}
      </button>
    </div>
  )
}

function GoalDetailModal({ goal, myEmail, onClose, onAddMoney, onShare, onEdit, onDelete }) {
  useLockBodyScroll()
  const [shareEmail, setShareEmail] = useState('')
  const [sharing, setSharing]       = useState(false)
  const [shareErr, setShareErr]     = useState('')
  const [showShare, setShowShare]   = useState(false)

  const isCreator = goal.created_by === myEmail
  const others    = goal.members.filter(m => m !== myEmail).length
  const pct       = goal.objetivo > 0 ? Math.min(100, (goal.ahorrado / goal.objetivo) * 100) : 0
  const done      = goal.ahorrado >= goal.objetivo

  async function submitShare() {
    const email = shareEmail.trim()
    if (!email) return
    setSharing(true)
    setShareErr('')
    try {
      await onShare(email)
      setShareEmail('')
      setShowShare(false)
    } catch (e) {
      setShareErr(e.message || 'No se pudo compartir')
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-sheet goal-detail-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />

        <div className="goal-detail-header">
          <GoalIcon goal={goal} className="goal-detail-emoji" />
          <div className="goal-detail-headtext">
            <div className="goal-detail-name">{goal.nombre}</div>
            {goal.fecha && <div className="goal-detail-date">para {goal.fecha}</div>}
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="goal-detail-amount">
          <span className={`goal-detail-ahorrado${done ? ' done' : ''}`}>{fmt(goal.ahorrado)}</span>
          <span className="goal-detail-objetivo"> / {fmt(goal.objetivo)}</span>
        </div>
        <div className="goal-bar-bg">
          <div className="goal-bar-fill" style={{
            width: `${pct}%`,
            background: done ? 'var(--green, #2dd4a0)' : 'var(--accent)',
          }} />
        </div>
        <div className="goal-item-foot" style={{ marginBottom: 14 }}>
          <span className="goal-pct">{done ? '¡Completada! 🎉' : `${Math.round(pct)}%`}</span>
        </div>

        <AddMoneyRow onAdd={onAddMoney} />

        <div className="goal-members">
          <span className="goal-members-label">
            {others > 0 ? `Compartida con ${others} persona${others !== 1 ? 's' : ''}` : 'Meta personal'}
          </span>
          {!showShare && (
            <button className="goal-share-btn" onClick={() => setShowShare(true)}>+ Compartir</button>
          )}
        </div>

        {showShare && (
          <div className="goal-share-row">
            <input
              className="setup-input"
              placeholder="email de la otra persona"
              value={shareEmail}
              onChange={e => setShareEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitShare()}
              autoFocus
            />
            <button className="goal-share-confirm" onClick={submitShare} disabled={sharing}>
              {sharing ? '…' : 'Invitar'}
            </button>
          </div>
        )}
        {shareErr && <p className="cat-err">{shareErr}</p>}

        {goal.contributions?.length > 0 && (
          <div className="goal-contributions">
            <span className="goal-contributions-label">Aportaciones</span>
            <div className="goal-contributions-list">
              {goal.contributions.map((c, i) => (
                <div key={i} className="goal-contribution-row">
                  <span className="goal-contribution-name">
                    {c.user_email === myEmail ? 'Tú' : c.name}
                  </span>
                  <span className="goal-contribution-date">{formatContribDate(c.fecha)}</span>
                  <span className="goal-contribution-amount">+{fmt(c.importe)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isCreator && (
          <div className="goal-detail-actions">
            <button className="catmodal-back" onClick={onEdit}>Editar meta</button>
            <button className="goal-delete-btn" onClick={onDelete}>Eliminar</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SavingsGoals() {
  const { goals, status, addGoal, editGoal, removeGoal, addMoney, share } = useSavingsGoals()
  const { user } = useAuth()
  const [showForm, setShowForm]     = useState(false)
  const [formGoal, setFormGoal]     = useState(null)
  const [detailGoal, setDetailGoal] = useState(null)

  function openCreate()          { setFormGoal(null); setShowForm(true) }
  function openEditForm(g)       { setFormGoal(g); setShowForm(true); setDetailGoal(null) }
  function closeForm()           { setShowForm(false); setFormGoal(null) }

  async function handleSaveForm(data) {
    if (formGoal) await editGoal(formGoal.id, data)
    else          await addGoal(data)
    closeForm()
  }

  async function handleDelete() {
    if (!detailGoal) return
    await removeGoal(detailGoal.id)
    setDetailGoal(null)
  }

  // Mantiene el modal de detalle sincronizado tras refrescar (nuevas contribuciones, etc.)
  const liveDetail = detailGoal ? (goals.find(g => g.id === detailGoal.id) ?? detailGoal) : null

  return (
    <div className="goals-section">
      <div className="goals-header">
        <span className="goals-title">🎯 Metas de ahorro</span>
      </div>

      {status === 'error' && <p className="goals-empty">No se pudieron cargar las metas.</p>}

      <div className="goals-grid">
        {goals.map(g => {
          const pct    = g.objetivo > 0 ? Math.min(100, (g.ahorrado / g.objetivo) * 100) : 0
          const done   = g.ahorrado >= g.objetivo
          const shared = g.members.length > 1
          return (
            <button key={g.id} className="goal-square" onClick={() => setDetailGoal(g)}>
              {shared && <span className="goal-square-shared">👥</span>}
              <GoalIcon goal={g} className="goal-square-emoji" />
              <span className="goal-square-name">{g.nombre}</span>
              <div className="goal-square-bar-bg">
                <div className="goal-square-bar-fill" style={{
                  width: `${pct}%`,
                  background: done ? 'var(--green, #2dd4a0)' : 'var(--accent)',
                }} />
              </div>
              <span className="goal-square-pct">{Math.round(pct)}%</span>
            </button>
          )
        })}
        <button className="goal-square goal-square-new" onClick={openCreate}>
          <span className="goal-square-emoji">＋</span>
          <span className="goal-square-name">Nueva</span>
        </button>
      </div>

      {showForm && (
        <GoalFormModal goal={formGoal} onSave={handleSaveForm} onClose={closeForm} />
      )}

      {liveDetail && (
        <GoalDetailModal
          goal={liveDetail}
          myEmail={user?.email}
          onClose={() => setDetailGoal(null)}
          onAddMoney={amt => addMoney(liveDetail.id, amt)}
          onShare={email => share(liveDetail.id, email)}
          onEdit={() => openEditForm(liveDetail)}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
