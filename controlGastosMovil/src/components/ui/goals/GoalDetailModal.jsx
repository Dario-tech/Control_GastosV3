import { useState, useRef, useEffect, useCallback } from 'react'
import { fetchContributionPhoto, getCachedPhoto } from '../../../services/api'
import { useLockBodyScroll } from '../../../hooks/useLockBodyScroll'
import { fmt } from '../../../utils'
import { FormScreen, Field, Section, AmountInput, Chips, DangerButton, PrimaryButton, ConfirmSheet, Sheet, Icon } from '../FormKit'
import { GoalRing, GoalIcon } from './GoalRing'
import { goalRemaining, formatGoalDate, formatContribDate, compressImage } from './goalUtils'
import Amt from '../Amt'

// La lista de metas ya no trae las fotos (solo `tiene_foto`): se piden al abrir
// una aportación. Estado: loading | ready | error. Caché en memoria en api.js.
const hasPhoto = c => !!(c?.tiene_foto || c?.foto)

export function useContributionPhoto(goalId, contribution) {
  const id = contribution?.id
  const [state, setState] = useState({ status: 'idle', src: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (id == null) { setState({ status: 'idle', src: null }); return }
    if (contribution.foto) { setState({ status: 'ready', src: contribution.foto }); return }
    const cached = getCachedPhoto(id)
    if (cached) { setState({ status: 'ready', src: cached }); return }
    let alive = true
    setState({ status: 'loading', src: null })
    fetchContributionPhoto(goalId, id)
      .then(src => { if (alive) setState({ status: 'ready', src }) })
      .catch(() => { if (alive) setState({ status: 'error', src: null }) })
    return () => { alive = false }
  }, [goalId, id, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => setAttempt(n => n + 1), [])
  return { ...state, retry }
}

function PhotoLightbox({ goalId, contribution, myEmail, onClose }) {
  const { status, src, retry } = useContributionPhoto(goalId, contribution)
  return (
    <div className="fm-lightbox" role="dialog" aria-modal="true" aria-label="Foto de recuerdo" onClick={onClose}>
      <button type="button" className="fm-icon-btn fm-lightbox-close" onClick={onClose} aria-label="Cerrar foto">
        <Icon name="close" />
      </button>
      {status === 'ready' && <img className="fm-lightbox-img" src={src} alt="Recuerdo" />}
      {status === 'loading' && (
        <div className="fm-lightbox-caption" role="status"><span className="fm-spinner" aria-hidden="true" /> Cargando foto…</div>
      )}
      {status === 'error' && (
        <div className="fm-lightbox-caption" role="alert" onClick={e => e.stopPropagation()}>
          No se pudo cargar la foto.{' '}
          <button type="button" className="fm-secondary" onClick={retry}>Reintentar</button>
        </div>
      )}
      <div className="fm-lightbox-caption tabular">
        {contribution.user_email === myEmail ? 'Tú' : contribution.name} · {formatContribDate(contribution.fecha)} · <Amt>+{fmt(contribution.importe)}</Amt>
      </div>
    </div>
  )
}

export default function GoalDetailModal({ goal, myEmail, onClose, onAddMoney, onShare, onEdit, onDelete, onDeleteContribution }) {
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
  const memories  = (goal.contributions || []).filter(hasPhoto)
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
            {amt > 0 ? <>Añadir <Amt>{fmt(amt, Number.isInteger(amt) ? 0 : 2)}</Amt></> : 'Añadir dinero'}
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
          <span className="fm-goal-hero-saved"><Amt>{fmt(goal.ahorrado)}</Amt></span>
          <span className="fm-goal-hero-target"> / <Amt>{fmt(goal.objetivo)}</Amt></span>
        </div>
        <div className="fm-goal-hero-status">
          {done ? <span className="fm-pill ok"><Icon name="check" size={14} />¡Completada!</span> : (
            <>
              <span className="fm-pill">{Math.round(pct)}% · faltan <b className="tabular"><Amt>{fmt(remaining.falta)}</Amt></b></span>
              {remaining.mes != null && <span className="fm-goal-hero-hint tabular">≈ <Amt>{fmt(remaining.mes)}</Amt>/mes hasta {formatGoalDate(goal.fecha)}</span>}
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
                <span className="fm-memory-img" aria-hidden="true" style={{ display: 'grid', placeItems: 'center' }}><Icon name="camera" size={26} /></span>
                <span className="fm-memory-caption tabular"><Amt>+{fmt(c.importe)}</Amt></span>
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
                {hasPhoto(c) && (
                  <button type="button" className="fm-icon-btn fm-icon-btn--sm" onClick={() => setLightbox(c)} aria-label="Ver foto">
                    <Icon name="camera" size={16} />
                  </button>
                )}
                <div className="fm-list-main">
                  <span className="fm-list-name">{c.user_email === myEmail ? 'Tú' : c.name}</span>
                  <span className="fm-list-date">{formatContribDate(c.fecha)}</span>
                </div>
                <span className="fm-list-amount tabular"><Amt>+{fmt(c.importe)}</Amt></span>
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
        <PhotoLightbox goalId={goal.id} contribution={lightbox} myEmail={myEmail} onClose={() => setLightbox(null)} />
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
