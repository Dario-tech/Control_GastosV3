import { useState, useRef } from 'react'
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

// Redimensiona y comprime la foto en el cliente antes de subirla: las fotos
// se guardan en la base de datos (sin object storage), así que el tamaño importa.
async function compressImage(file, maxDim = 800, quality = 0.72) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload  = () => resolve(i)
      i.onerror = () => reject(new Error('No se pudo leer la imagen'))
      i.src = url
    })
    const scale  = Math.min(1, maxDim / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width  = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function GoalIcon({ goal, className }) {
  if (goal.imagen_url) return <img className={className} src={goal.imagen_url} alt={goal.nombre} />
  return <span className={className}>{goal.emoji}</span>
}

function GoalFormModal({ goal, onSave, onClose }) {
  useLockBodyScroll()
  const [nombre, setNombre]     = useState(goal?.nombre ?? '')
  const [objetivo, setObjetivo] = useState(goal?.objetivo != null ? String(goal.objetivo) : '')
  const [fecha, setFecha]       = useState(goal?.fecha ?? '')
  const [emoji, setEmoji]       = useState(goal?.emoji ?? '🎯')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const objetivoNum = parseFloat(String(objetivo).replace(',', '.'))
  const canSave = nombre.trim() && objetivoNum > 0 && !saving

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      await onSave({ nombre: nombre.trim(), objetivo: objetivoNum, fecha: fecha || null, emoji })
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
  const [foto, setFoto]   = useState(null)   // data-URL ya comprimida
  const [busy, setBusy]   = useState(false)
  const fileRef = useRef(null)
  const amt = parseFloat(String(value).replace(',', '.'))
  const canAdd = amt > 0 && !busy

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir la misma foto
    if (!file) return
    try {
      setFoto(await compressImage(file))
    } catch {
      alert('No se pudo procesar la foto. Prueba con otra.')
    }
  }

  async function submit() {
    if (!canAdd) return
    setBusy(true)
    try {
      await onAdd(amt, foto)
      setValue('')
      setFoto(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="goal-addmoney">
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
        <button
          className={`goal-photo-btn${foto ? ' has-photo' : ''}`}
          onClick={() => fileRef.current?.click()}
          aria-label="Adjuntar foto"
          title="Adjuntar una foto de recuerdo"
        >
          📷
        </button>
        <button className="goal-addmoney-btn" onClick={submit} disabled={!canAdd}>
          {busy ? '…' : 'Añadir'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      {foto && (
        <div className="goal-photo-preview-row">
          <img className="goal-photo-preview" src={foto} alt="Foto adjunta" />
          <span className="goal-photo-preview-hint">Se guardará con tu aportación</span>
          <button className="goal-photo-remove" onClick={() => setFoto(null)} aria-label="Quitar foto">✕</button>
        </div>
      )}
    </div>
  )
}

function GoalDetailModal({ goal, myEmail, onClose, onAddMoney, onShare, onEdit, onDelete, onDeleteContribution }) {
  useLockBodyScroll()
  const [shareEmail, setShareEmail]   = useState('')
  const [sharing, setSharing]         = useState(false)
  const [shareErr, setShareErr]       = useState('')
  const [showShare, setShowShare]     = useState(false)
  const [removingId, setRemovingId]   = useState(null)
  const [lightbox, setLightbox]       = useState(null) // contribución cuya foto se amplía

  const isCreator = goal.created_by === myEmail
  const others    = goal.members.filter(m => m !== myEmail).length
  const pct       = goal.objetivo > 0 ? Math.min(100, (goal.ahorrado / goal.objetivo) * 100) : 0
  const done      = goal.ahorrado >= goal.objetivo
  const memories  = (goal.contributions || []).filter(c => c.foto)

  async function handleDeleteContribution(c) {
    if (!window.confirm(`¿Eliminar esta aportación de ${fmt(c.importe)}?`)) return
    setRemovingId(c.id)
    try {
      await onDeleteContribution(c.id)
    } finally {
      setRemovingId(null)
    }
  }

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
      <div className="modal-sheet goal-detail-sheet fullscreen" onClick={e => e.stopPropagation()}>
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

        {memories.length > 0 && (
          <div className="goal-memories">
            <span className="goal-contributions-label">📸 Recuerdos</span>
            <div className="goal-memories-grid">
              {memories.map(c => (
                <button key={c.id} className="goal-memory" onClick={() => setLightbox(c)}>
                  <img className="goal-memory-img" src={c.foto} alt="Recuerdo" loading="lazy" />
                  <span className="goal-memory-caption">+{fmt(c.importe)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {goal.contributions?.length > 0 && (
          <div className="goal-contributions">
            <span className="goal-contributions-label">Aportaciones</span>
            <div className="goal-contributions-list">
              {goal.contributions.map(c => (
                <div key={c.id} className="goal-contribution-row">
                  {c.foto && (
                    <img
                      className="goal-contribution-thumb"
                      src={c.foto}
                      alt=""
                      onClick={() => setLightbox(c)}
                    />
                  )}
                  <span className="goal-contribution-name">
                    {c.user_email === myEmail ? 'Tú' : c.name}
                  </span>
                  <span className="goal-contribution-date">{formatContribDate(c.fecha)}</span>
                  <span className="goal-contribution-amount">+{fmt(c.importe)}</span>
                  {(c.user_email === myEmail || isCreator) && (
                    <button
                      className="goal-contribution-delete"
                      onClick={() => handleDeleteContribution(c)}
                      disabled={removingId === c.id}
                      aria-label="Eliminar aportación"
                    >
                      {removingId === c.id ? '…' : '✕'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {lightbox && (
          <div className="goal-lightbox" onClick={() => setLightbox(null)}>
            <img className="goal-lightbox-img" src={lightbox.foto} alt="Recuerdo" />
            <div className="goal-lightbox-caption">
              {lightbox.user_email === myEmail ? 'Tú' : lightbox.name} · {formatContribDate(lightbox.fecha)} · +{fmt(lightbox.importe)}
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

// `compact`: bloque de solo consulta para la pantalla principal — muestra las
// metas existentes (y abre su detalle) pero no permite crear nuevas; la
// gestión completa vive en la pestaña Presupuesto.
export default function SavingsGoals({ compact = false }) {
  const { goals, status, addGoal, editGoal, removeGoal, addMoney, share, removeContribution } = useSavingsGoals()
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

  // En la pantalla principal solo se consulta: si no hay metas, no ocupamos sitio.
  if (compact && status !== 'error' && goals.length === 0) return null

  return (
    <div
      className={`goals-section${compact ? ' goals-section--compact' : ''}`}
      data-tour={compact ? undefined : 'goals'}
    >
      <div className="goals-header">
        <span className="goals-title">🎯 Metas de ahorro</span>
      </div>

      {status === 'error' && <p className="goals-empty">No se pudieron cargar las metas.</p>}

      <div className={`goals-grid${compact ? ' goals-grid--compact' : ''}`}>
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
        {!compact && (
          <button className="goal-square goal-square-new" onClick={openCreate}>
            <span className="goal-square-emoji">＋</span>
            <span className="goal-square-name">Nueva</span>
          </button>
        )}
      </div>

      {showForm && (
        <GoalFormModal goal={formGoal} onSave={handleSaveForm} onClose={closeForm} />
      )}

      {liveDetail && (
        <GoalDetailModal
          goal={liveDetail}
          myEmail={user?.email}
          onClose={() => setDetailGoal(null)}
          onAddMoney={(amt, foto) => addMoney(liveDetail.id, amt, foto)}
          onShare={email => share(liveDetail.id, email)}
          onEdit={() => openEditForm(liveDetail)}
          onDelete={handleDelete}
          onDeleteContribution={contribId => removeContribution(liveDetail.id, contribId)}
        />
      )}
    </div>
  )
}
