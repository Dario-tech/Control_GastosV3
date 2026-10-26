import { lazy, Suspense, useState } from 'react'
import { useSavingsGoals } from '../../hooks/useSavingsGoals'
import { useAuth } from '../../context/AuthContext'
import { useApp } from '../../context/AppContext'
import { fmt } from '../../utils'
import { GoalRing, GoalIcon } from './goals/GoalRing'
import { goalRemaining, formatGoalDate } from './goals/goalUtils'
import { FormSkeleton } from './Skeleton'
import Amt from './Amt'

// El formulario y el detalle solo se necesitan al abrirlos: van en su propio
// chunk para no cargarlos con la pantalla principal (Año usa este bloque).
const GoalFormModal   = lazy(() => import('./goals/GoalFormModal'))
const GoalDetailModal = lazy(() => import('./goals/GoalDetailModal'))

// `compact`: bloque de solo consulta para la pantalla principal — muestra las
// metas existentes (y abre su detalle) pero no permite crear nuevas; la
// gestión completa vive en la pestaña Presupuesto.
// `compact` también alinea el bloque a la derecha (mitad de ancho).
export default function SavingsGoals({ compact = false }) {
  const rightAligned = compact
  const { goals, status, addGoal, editGoal, removeGoal, addMoney, share, removeContribution } = useSavingsGoals()
  const { user } = useAuth()
  const showToast = useApp()?.showToast ?? (() => {})
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
                  <Amt><b>{fmt(g.ahorrado)}</b> / {fmt(g.objetivo)}</Amt>
                </span>
              )}
              {!compact && (
                <>
                  <span className="goal-square-amounts">
                    <Amt><b>{fmt(g.ahorrado)}</b> / {fmt(g.objetivo)}</Amt>
                  </span>
                  <span className="goal-square-foot">
                    {done ? '¡Lograda! 🎉' : <>Faltan <Amt>{fmt(remaining.falta)}</Amt></>}
                  </span>
                  {!done && g.fecha && (
                    <span className="goal-square-date">
                      {formatGoalDate(g.fecha)}{remaining.mes != null && <> · <Amt>{fmt(remaining.mes)}</Amt>/mes</>}
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

      <Suspense fallback={<FormSkeleton />}>
        {showForm && (
          <GoalFormModal goal={formGoal} onSave={handleSaveForm} onClose={closeForm} />
        )}

        {liveDetail && (
          <GoalDetailModal
            goal={liveDetail}
            myEmail={user?.email}
            onClose={() => setDetailGoal(null)}
            onAddMoney={(amt, foto) => addMoney(liveDetail.id, amt, foto)}
            onShare={async email => {
              const msg = await share(liveDetail.id, email)
              showToast(typeof msg === 'string' && msg ? msg : 'Si la cuenta existe, se ha compartido la meta')
            }}
            onEdit={() => openEditForm(liveDetail)}
            onDelete={handleDelete}
            onDeleteContribution={contribId => removeContribution(liveDetail.id, contribId)}
          />
        )}
      </Suspense>
    </div>
  )
}
