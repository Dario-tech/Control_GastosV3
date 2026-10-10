import { useState, useRef, useId } from 'react'
import { useSavingsGoals } from '../../hooks/useSavingsGoals'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { useAuth } from '../../context/AuthContext'
import { fmt } from '../../utils'
import { FormScreen, Field, Section, AmountInput, Chips, TileGrid, PrimaryButton, DangerButton, ConfirmSheet, Sheet, Icon } from './FormKit'

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

// Anillo de progreso (SVG). pathLength=100 -> el desplazamiento es directamente el % restante.
function GoalRing({ pct, done, size = 'md', children }) {
  const gid = useId()
  return (
    <div className={`goal-ring goal-ring--${size}${done ? ' done' : ''}`} style={{ '--off': 100 - pct }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   className="goal-ring-stop-a" />
            <stop offset="100%" className="goal-ring-stop-b" />
          </linearGradient>
        </defs>
        <circle className="goal-ring-track" cx="50" cy="50" r="42" pathLength="100" />
        {pct > 0 && (
          <circle className="goal-ring-fg" cx="50" cy="50" r="42" pathLength="100" stroke={`url(#${gid})`} />
        )}
      </svg>
      <div className="goal-ring-center">{children}</div>
    </div>
  )
}

// Texto de apoyo: cuánto falta y, si hay fecha futura, cuánto aportar al mes.
function goalRemaining(goal) {
  const falta = Math.max(0, goal.objetivo - goal.ahorrado)
  let mes = null
  if (falta > 0 && goal.fecha) {
    const d = new Date(goal.fecha)
    if (!isNaN(d)) {
      const now = new Date()
      const months = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
      if (months > 0) mes = falta / months
    }
  }
  return { falta, mes }
}

function formatGoalDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })
  } catch { return iso }
}

// Fecha local en formato YYYY-MM-DD (sin pasar por UTC, que desplaza el día).
function toIso(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function addMonthsIso(n) {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return toIso(d)
}
const DATE_SHORTCUTS = [
  { key: '6m',  label: 'En 6 meses',   iso: () => addMonthsIso(6) },
  { key: 'eoy', label: 'Fin de año',   iso: () => `${new Date().getFullYear()}-12-31` },
  { key: '1y',  label: '1 año',        iso: () => addMonthsIso(12) },
  { key: '2y',  label: '2 años',       iso: () => addMonthsIso(24) },
  { key: 'none', label: 'Sin fecha',   iso: () => '' },
]
const GOAL_QUICK = [1000, 3000, 5000, 10000].map(v => ({ key: v, label: fmt(v), value: v }))

function GoalFormModal({ goal, onSave, onClose }) {
  useLockBodyScroll()
  const [nombre, setNombre]     = useState(goal?.nombre ?? '')
  const [objetivo, setObjetivo] = useState(goal?.objetivo != null ? String(goal.objetivo) : '')
  const [fecha, setFecha]       = useState(goal?.fecha ?? '')
  const [emoji, setEmoji]       = useState(goal?.emoji ?? '🎯')
  const [touched, setTouched]   = useState({})
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const touch = k => setTouched(t => ({ ...t, [k]: true }))
  const objetivoNum = parseFloat(String(objetivo).replace(',', '.'))
  const nombreOk   = nombre.trim().length > 0
  const objetivoOk = objetivoNum > 0
  const canSave = nombreOk && objetivoOk && !saving
  const pastDate = !!fecha && fecha < toIso(new Date())

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

  // Vista previa: anillo con el progreso real (al editar) y cuota mensual estimada.
  const prevGoal = { objetivo: objetivoOk ? objetivoNum : 0, ahorrado: goal?.ahorrado ?? 0, fecha: fecha || null }
  const prevPct  = prevGoal.objetivo > 0 ? Math.min(100, (prevGoal.ahorrado / prevGoal.objetivo) * 100) : 0
  const prevRem  = goalRemaining(prevGoal)

  const missing = !nombreOk ? 'Ponle un nombre a tu meta para continuar' : 'Indica un objetivo mayor que 0'

  return (
    <FormScreen
      title={goal ? 'Editar meta' : 'Nueva meta'}
      subtitle="Elige un icono, ponle nombre y fija cuánto quieres ahorrar."
      onClose={onClose}
      error={error}
      footer={
        <PrimaryButton loading={saving} disabled={!canSave} hint={missing} onClick={submit}>
          {goal ? 'Guardar cambios' : 'Crear meta'}
        </PrimaryButton>
      }
    >
      {/* Vista previa en vivo: la tarjeta tal y como se verá en Planificación */}
      <div className="fm-preview fm-preview--goal" aria-label="Vista previa de la meta">
        <span className="fm-preview-tag">Vista previa</span>
        <GoalRing pct={prevPct} size="lg">
          <span className="fm-preview-ring-emoji">{emoji}</span>
        </GoalRing>
        <div className="fm-preview-goal-name">
          <span className={nombreOk ? '' : 'muted'}>{nombreOk ? nombre.trim() : 'Nombre de tu meta'}</span>
        </div>
        <div className="fm-preview-goal-amounts tabular">
          <b>{fmt(prevGoal.ahorrado)}</b> / {fmt(prevGoal.objetivo)}
        </div>
        <span className="fm-preview-foot tabular">
          {prevRem.mes != null
            ? `≈ ${fmt(prevRem.mes)}/mes hasta ${formatGoalDate(fecha)}`
            : (fecha ? `Para ${formatGoalDate(fecha)}` : 'Sin fecha límite')}
        </span>
      </div>

      <Section title="Icono">
        <TileGrid
          label="Icono de la meta"
          columns={5}
          items={GOAL_EMOJIS.map(e => ({ key: e, icon: e, ariaLabel: `Icono ${e}`, emoji: e }))}
          isSelected={it => emoji === it.emoji}
          onSelect={it => setEmoji(it.emoji)}
        />
      </Section>

      <Field label="Nombre" error={touched.nombre && !nombreOk ? 'Escribe un nombre para tu meta.' : ''}>
        {({ id, describedBy, invalid }) => (
          <input id={id} className="fm-input" value={nombre} maxLength={40}
            aria-invalid={invalid || undefined} aria-describedby={describedBy}
            onChange={e => setNombre(e.target.value)} onBlur={() => touch('nombre')}
            placeholder="Vacaciones, coche nuevo…" autoComplete="off" enterKeyHint="next" />
        )}
      </Field>

      <Field label="Objetivo" error={touched.objetivo && !objetivoOk ? 'Introduce un objetivo mayor que 0.' : ''}>
        {({ id, describedBy, invalid }) => (
          <>
            <AmountInput id={id} describedBy={describedBy} invalid={invalid} value={objetivo}
              onChange={setObjetivo} onBlur={() => touch('objetivo')} />
            <Chips
              label="Objetivos rápidos"
              options={GOAL_QUICK}
              isActive={o => objetivoNum === o.value}
              onPick={o => { setObjetivo(String(o.value)); touch('objetivo') }}
            />
          </>
        )}
      </Field>

      <Field
        label="Fecha objetivo"
        optional
        hint={!fecha ? 'Con una fecha te decimos cuánto aportar al mes.' : ''}
        error={pastDate ? 'Esa fecha ya ha pasado: no podremos calcular una cuota mensual.' : ''}
      >
        {({ id, describedBy, invalid }) => (
          <>
            <input id={id} className="fm-input" type="date" value={fecha}
              aria-invalid={invalid || undefined} aria-describedby={describedBy}
              onChange={e => setFecha(e.target.value)} />
            <Chips
              label="Atajos de fecha"
              options={DATE_SHORTCUTS}
              isActive={o => (o.key === 'none' ? !fecha : fecha === o.iso())}
              onPick={o => setFecha(o.iso())}
            />
          </>
        )}
      </Field>

    </FormScreen>
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
  const [confirmContrib, setConfirmContrib] = useState(null)
  const [confirmGoal, setConfirmGoal] = useState(false)

  // Añadir dinero (estado elevado para que el botón principal viva en el pie fijo)
  const [value, setValue]   = useState('')
  const [foto, setFoto]     = useState(null)   // data-URL ya comprimida
  const [busy, setBusy]     = useState(false)
  const [photoErr, setPhotoErr] = useState('')
  const fileRef = useRef(null)
  const amt = parseFloat(String(value).replace(',', '.'))
  const canAdd = amt > 0 && !busy

  const isCreator = goal.created_by === myEmail
  const others    = goal.members.filter(m => m !== myEmail).length
  const pct       = goal.objetivo > 0 ? Math.min(100, (goal.ahorrado / goal.objetivo) * 100) : 0
  const done      = goal.ahorrado >= goal.objetivo
  const memories  = (goal.contributions || []).filter(c => c.foto)
  const remaining = goalRemaining(goal)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir la misma foto
    if (!file) return
    setPhotoErr('')
    try {
      setFoto(await compressImage(file))
    } catch {
      setPhotoErr('No se pudo procesar la foto. Prueba con otra.')
    }
  }

  async function submitAdd() {
    if (!canAdd) return
    setBusy(true)
    try {
      await onAddMoney(amt, foto)
      setValue('')
      setFoto(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteContribution(c) {
    setRemovingId(c.id)
    try {
      await onDeleteContribution(c.id)
    } finally {
      setRemovingId(null)
      setConfirmContrib(null)
    }
  }

  const emailTrim = shareEmail.trim()
  const emailOk = /^\S+@\S+\.\S+$/.test(emailTrim)

  async function submitShare() {
    if (!emailOk || sharing) return
    setSharing(true)
    setShareErr('')
    try {
      await onShare(emailTrim)
      setShareEmail('')
      setShowShare(false)
    } catch (e) {
      setShareErr(e.message || 'No se pudo compartir')
    } finally {
      setSharing(false)
    }
  }

  function closeShare() { setShowShare(false); setShareErr(''); setShareEmail('') }

  return (
    <FormScreen
      title={goal.nombre}
      subtitle={goal.fecha ? `Meta para ${formatGoalDate(goal.fecha)}` : 'Meta de ahorro'}
      label={`Meta ${goal.nombre}`}
      onClose={onClose}
      headerRight={isCreator && (
        <button type="button" className="fm-icon-btn" onClick={onEdit} aria-label="Editar meta">
          <Icon name="pencil" />
        </button>
      )}
      footer={
        done ? null : (
          <PrimaryButton loading={busy} disabled={!canAdd} hint="Escribe cuánto quieres añadir" onClick={submitAdd}>
            {amt > 0 ? `Añadir ${fmt(amt, Number.isInteger(amt) ? 0 : 2)}` : 'Añadir dinero'}
          </PrimaryButton>
        )
      }
    >
      {/* Resumen con anillo */}
      <div className={`fm-goal-hero${done ? ' done' : ''}`}>
        <GoalRing pct={pct} done={done} size="lg">
          <GoalIcon goal={goal} className="fm-goal-hero-icon" />
        </GoalRing>
        <div className="fm-goal-hero-amount tabular">
          <span className="fm-goal-hero-saved">{fmt(goal.ahorrado)}</span>
          <span className="fm-goal-hero-target"> / {fmt(goal.objetivo)}</span>
        </div>
        <div className="fm-goal-hero-status">
          {done ? <span className="fm-pill ok"><Icon name="check" size={14} />¡Completada!</span> : (
            <>
              <span className="fm-pill">{Math.round(pct)}% · faltan <b className="tabular">{fmt(remaining.falta)}</b></span>
              {remaining.mes != null && <span className="fm-goal-hero-hint tabular">≈ {fmt(remaining.mes)}/mes hasta {formatGoalDate(goal.fecha)}</span>}
            </>
          )}
        </div>
      </div>

      {/* Añadir dinero */}
      {!done && (
        <Section title="Añadir dinero">
          <div className="fm-card fm-addmoney">
            <AmountInput size="md" value={value} onChange={setValue} onEnter={submitAdd} ariaLabel="Importe a añadir" />
            <Chips
              label="Importes rápidos"
              options={[10, 25, 50, 100].map(v => ({ key: v, label: `+${fmt(v)}`, value: v }))}
              onPick={o => setValue(String((Number.isFinite(amt) ? amt : 0) + o.value))}
            />
            <input ref={fileRef} type="file" accept="image/*" className="fm-file" onChange={handleFile} tabIndex={-1} />
            {foto ? (
              <div className="fm-photo-row">
                <img className="fm-photo-thumb" src={foto} alt="Foto adjunta" />
                <span className="fm-photo-text">Se guardará con tu aportación</span>
                <button type="button" className="fm-icon-btn fm-icon-btn--sm" onClick={() => setFoto(null)} aria-label="Quitar foto">
                  <Icon name="close" size={16} />
                </button>
              </div>
            ) : (
              <button type="button" className="fm-secondary fm-secondary--wide" onClick={() => fileRef.current?.click()}>
                <Icon name="camera" size={18} />Adjuntar foto de recuerdo
              </button>
            )}
            {photoErr && <p className="fm-error" role="alert"><Icon name="alert" size={15} />{photoErr}</p>}
          </div>
        </Section>
      )}

      {/* Miembros / compartir */}
      <div className="fm-card fm-members">
        <span className="fm-members-icon"><Icon name="users" /></span>
        <div className="fm-members-text">
          <span className="fm-members-title">
            {others > 0 ? `Compartida con ${others} persona${others !== 1 ? 's' : ''}` : 'Meta personal'}
          </span>
          <span className="fm-members-sub">Ahorrad juntos y ved el progreso a la vez</span>
        </div>
        <button type="button" className="fm-chip" onClick={() => setShowShare(true)}>Compartir</button>
      </div>

      {memories.length > 0 && (
        <Section title="Recuerdos">
          <div className="fm-memories">
            {memories.map(c => (
              <button key={c.id} type="button" className="fm-memory" onClick={() => setLightbox(c)} aria-label={`Ver foto de +${fmt(c.importe)}`}>
                <img className="fm-memory-img" src={c.foto} alt="" loading="lazy" />
                <span className="fm-memory-caption tabular">+{fmt(c.importe)}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {goal.contributions?.length > 0 && (
        <Section title="Aportaciones">
          <div className="fm-card fm-list">
            {goal.contributions.map(c => (
              <div key={c.id} className="fm-list-row">
                {c.foto && (
                  <button type="button" className="fm-list-thumb-btn" onClick={() => setLightbox(c)} aria-label="Ver foto">
                    <img className="fm-list-thumb" src={c.foto} alt="" />
                  </button>
                )}
                <div className="fm-list-main">
                  <span className="fm-list-name">{c.user_email === myEmail ? 'Tú' : c.name}</span>
                  <span className="fm-list-date">{formatContribDate(c.fecha)}</span>
                </div>
                <span className="fm-list-amount tabular">+{fmt(c.importe)}</span>
                {(c.user_email === myEmail || isCreator) && (
                  <button
                    type="button"
                    className="fm-list-del"
                    onClick={() => setConfirmContrib(c)}
                    disabled={removingId === c.id}
                    aria-label={`Eliminar aportación de ${fmt(c.importe)}`}
                  >
                    {removingId === c.id ? <span className="fm-spinner" aria-hidden="true" /> : <Icon name="close" size={16} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {isCreator && (
        <DangerButton onClick={() => setConfirmGoal(true)}>Eliminar meta</DangerButton>
      )}

      {lightbox && (
        <div className="fm-lightbox" role="dialog" aria-modal="true" aria-label="Foto de recuerdo" onClick={() => setLightbox(null)}>
          <button type="button" className="fm-icon-btn fm-lightbox-close" onClick={() => setLightbox(null)} aria-label="Cerrar foto">
            <Icon name="close" />
          </button>
          <img className="fm-lightbox-img" src={lightbox.foto} alt="Recuerdo" />
          <div className="fm-lightbox-caption tabular">
            {lightbox.user_email === myEmail ? 'Tú' : lightbox.name} · {formatContribDate(lightbox.fecha)} · +{fmt(lightbox.importe)}
          </div>
        </div>
      )}

      {showShare && (
        <Sheet title="Compartir meta" onClose={closeShare}>
          <p className="fm-sheet-msg">Invita a otra persona por email para que también pueda aportar y ver el progreso.</p>
          <Field label="Email" error={shareErr || (shareEmail && !emailOk ? 'Revisa el formato del email.' : '')}>
            {({ id, describedBy, invalid }) => (
              <input id={id} className="fm-input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none"
                placeholder="nombre@correo.com" value={shareEmail}
                aria-invalid={invalid || undefined} aria-describedby={describedBy}
                onChange={e => { setShareEmail(e.target.value); setShareErr('') }}
                onKeyDown={e => e.key === 'Enter' && submitShare()}
                autoFocus />
            )}
          </Field>
          <div className="fm-sheet-actions">
            <button type="button" className="fm-secondary" onClick={closeShare} disabled={sharing}>Cancelar</button>
            <button type="button" className="fm-confirm" onClick={submitShare} disabled={!emailOk || sharing} aria-busy={sharing || undefined}>
              {sharing && <span className="fm-spinner" aria-hidden="true" />}<span>Invitar</span>
            </button>
          </div>
        </Sheet>
      )}

      {confirmContrib && (
        <ConfirmSheet
          title="¿Eliminar esta aportación?"
          message={`Se restarán ${fmt(confirmContrib.importe)} del total ahorrado de la meta.`}
          onCancel={() => setConfirmContrib(null)}
          onConfirm={() => handleDeleteContribution(confirmContrib)}
        />
      )}

      {confirmGoal && (
        <ConfirmSheet
          title="¿Eliminar esta meta?"
          message={`Se borrará "${goal.nombre}" con todas sus aportaciones. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar meta"
          onCancel={() => setConfirmGoal(false)}
          onConfirm={() => onDelete()}
        />
      )}
    </FormScreen>
  )
}

// `compact`: bloque de solo consulta para la pantalla principal — muestra las
// metas existentes (y abre su detalle) pero no permite crear nuevas; la
// gestión completa vive en la pestaña Presupuesto.
// `alignRight`: solo cambia el layout (bloque a la derecha, mitad de ancho),
// sin afectar a si se puede crear/gestionar. `compact` ya implica alineado
// a la derecha.
export default function SavingsGoals({ compact = false, alignRight = false }) {
  const rightAligned = compact  // alignRight ya no estrecha el bloque: las tarjetas con anillo necesitan ancho completo
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
      className={`goals-section${rightAligned ? ' goals-section--compact' : ''}`}
      data-tour={compact ? undefined : 'goals'}
    >
      <div className="goals-header">
        <span className="goals-title">🎯 Metas de ahorro</span>
      </div>

      {status === 'error' && <p className="goals-empty">No se pudieron cargar las metas.</p>}

      {!compact && status !== 'error' && goals.length === 0 && (
        <div className="goals-empty-state">
          <GoalRing pct={0} size="lg">
            <span className="goals-empty-emoji">🎯</span>
          </GoalRing>
          <div className="goals-empty-title">Tu primera meta de ahorro</div>
          <p className="goals-empty-text">Ponle nombre y objetivo a eso que quieres lograr y ve crecer tu progreso.</p>
          <button className="goals-empty-cta" onClick={openCreate}>Crear meta</button>
        </div>
      )}

      <div className={`goals-grid${rightAligned ? ' goals-grid--compact' : ''}`}>
        {goals.map(g => {
          const pct    = g.objetivo > 0 ? Math.min(100, (g.ahorrado / g.objetivo) * 100) : 0
          const done   = g.ahorrado >= g.objetivo
          const shared = g.members.length > 1
          const remaining = goalRemaining(g)
          return (
            <button key={g.id} className={`goal-square${done ? ' done' : ''}`} onClick={() => setDetailGoal(g)}>
              {shared && <span className="goal-square-shared">👥</span>}
              <GoalRing pct={pct} done={done} size={compact ? 'sm' : 'md'}>
                <span className="goal-ring-pct">{Math.round(pct)}<small>%</small></span>
              </GoalRing>
              <span className="goal-square-title">
                <GoalIcon goal={g} className="goal-square-emoji" />
                <span className="goal-square-name">{g.nombre}</span>
              </span>
              {compact && (
                <span className="goal-square-amounts">
                  <b>{fmt(g.ahorrado)}</b> / {fmt(g.objetivo)}
                </span>
              )}
              {!compact && (
                <>
                  <span className="goal-square-amounts">
                    <b>{fmt(g.ahorrado)}</b> / {fmt(g.objetivo)}
                  </span>
                  <span className="goal-square-foot">
                    {done ? '¡Lograda! 🎉' : `Faltan ${fmt(remaining.falta)}`}
                  </span>
                  {!done && g.fecha && (
                    <span className="goal-square-date">
                      {formatGoalDate(g.fecha)}{remaining.mes != null && ` · ${fmt(remaining.mes)}/mes`}
                    </span>
                  )}
                </>
              )}
            </button>
          )
        })}
        {!compact && goals.length > 0 && (
          <button className="goal-square goal-square-new" onClick={openCreate}>
            <span className="goal-new-plus">＋</span>
            <span className="goal-square-name">Nueva meta</span>
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
