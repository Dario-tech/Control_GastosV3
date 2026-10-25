import { lazy, Suspense, useState, useEffect } from 'react'
import { useAnnualExpenses } from '../../hooks/useAnnualExpenses'
import { fmt, todayLocal } from '../../utils'
import { MONTH_NAMES } from '../../data/mockData'
import { ConfirmSheet } from './FormKit'
import { FormSkeleton } from './Skeleton'
import { notifCache, annualProgress, dueState, downloadIcs } from './annual/annualUtils'
import Amt from './Amt'

// El formulario solo se necesita al abrirlo: va en su propio chunk.
const ExpenseFormModal = lazy(() => import('./annual/ExpenseFormModal'))

export default function AnnualExpenses() {
  const { expenses, status, addExpense, editExpense, removeExpense } = useAnnualExpenses()
  const [showForm, setShowForm]   = useState(false)
  const [formExpense, setFormExpense] = useState(null)
  const [confirmExp, setConfirmExp] = useState(null)
  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  )

  function openCreate()    { setFormExpense(null); setShowForm(true) }
  function openEdit(exp)   { setFormExpense(exp); setShowForm(true) }
  function closeForm()     { setShowForm(false); setFormExpense(null) }

  async function handleSave(data) {
    if (formExpense) await editExpense(formExpense.id, data)
    else             await addExpense(data)
    closeForm()
  }

  async function handleDelete(exp) {
    await removeExpense(exp.id)
    setConfirmExp(null)
  }

  async function requestNotifPermission() {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }

  // Avisa (notificación del navegador) una vez al día por cada gasto cuyo
  // aviso esté activo — igual que las alertas de presupuesto ya existentes.
  useEffect(() => {
    if (notifPermission !== 'granted') return
    const today = todayLocal()
    const cache = notifCache.get()
    let changed = false
    expenses.forEach(exp => {
      if (!exp.aviso_activo) return
      const key = `${exp.id}-${today}`
      if (cache[key]) return
      cache[key] = true
      changed = true
      new Notification(`📅 ${exp.nombre}`, {
        body: `Vence en ${exp.dias_restantes} día${exp.dias_restantes !== 1 ? 's' : ''} — ${fmt(exp.importe)}`,
        icon: '/icons/icon-192.png',
        tag: key,
      })
    })
    if (changed) notifCache.set(cache)
  }, [expenses, notifPermission])

  const sorted     = [...expenses].sort((a, b) => a.dias_restantes - b.dias_restantes)
  const totalAnual = expenses.reduce((t, e) => t + (e.importe || 0), 0)

  if (status !== 'error' && expenses.length === 0 && !showForm) {
    return (
      <div className="goals-section" data-tour="annual-expenses">
        <div className="goals-header">
          <span className="goals-title">📅 Gastos fijos anuales</span>
        </div>
        <div className="annual-empty">
          <div className="annual-empty-icon" aria-hidden="true">📅</div>
          <h3 className="annual-empty-title">Sin gastos fijos anuales</h3>
          <p className="annual-empty-desc">
            IBI, seguro del coche… configúralos una vez y la app te avisa cuando se acercan.
          </p>
          <button className="annual-primary-btn" onClick={openCreate}>Añadir gasto fijo</button>
        </div>
        {showForm && (
          <Suspense fallback={<FormSkeleton />}>
            <ExpenseFormModal expense={formExpense} onSave={handleSave} onClose={closeForm} />
          </Suspense>
        )}
      </div>
    )
  }

  return (
    <div className="goals-section" data-tour="annual-expenses">
      <div className="goals-header">
        <span className="goals-title">📅 Gastos fijos anuales</span>
        <button className="annual-add-btn" onClick={openCreate}>+ Añadir</button>
      </div>

      {status === 'error' && <p className="goals-empty">No se pudieron cargar los gastos fijos.</p>}

      {notifPermission === 'default' && expenses.some(e => e.avisar) && (
        <button className="notif-banner" onClick={requestNotifPermission}>
          <span>🔔</span>
          <span>Activa las notificaciones para que te avise cuando se acerquen</span>
          <span className="notif-banner-cta">Activar →</span>
        </button>
      )}

      {expenses.length > 0 && (
        <div className="annual-summary">
          <span className="annual-summary-label">A reservar al mes</span>
          <span className="annual-summary-main tabular"><Amt>{fmt(totalAnual / 12)}</Amt></span>
          <span className="annual-summary-sub tabular">
            Total anual <Amt>{fmt(totalAnual)}</Amt> · {expenses.length} gasto{expenses.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="annual-list">
        {sorted.map(exp => {
          const progress = annualProgress(exp)
          const due = dueState(exp)
          return (
          <div key={exp.id} className={`annual-item annual-st-${due.key}`}>
            <div className="annual-item-top" onClick={() => openEdit(exp)}>
              <span className="annual-item-icon" aria-hidden="true">🧾</span>
              <div className="annual-item-left">
                <span className="annual-item-name">{exp.nombre}</span>
                <span className="annual-item-due">{exp.dia} de {MONTH_NAMES[exp.mes - 1]}</span>
                <span className="annual-due-chip"><span aria-hidden="true">{due.icon}</span>{due.label}</span>
              </div>
              <span className="annual-item-amount">{fmt(exp.importe)}</span>
            </div>
            {exp.reparto_mensual != null && (
              <div className="annual-quota">
                <div className="annual-quota-dots" aria-hidden="true">
                  {exp.meses_reparto.map((m, i) => (
                    <span key={m} className={`annual-quota-dot${progress && i < progress.pasados ? ' done' : ''}`} />
                  ))}
                </div>
                <span className="annual-quota-text tabular">
                  {progress ? progress.pasados : 0}/{exp.meses_reparto.length} cuotas · <Amt>{fmt(exp.reparto_mensual)}</Amt>/mes
                </span>
              </div>
            )}
            <div className="annual-item-actions">
              <button className="annual-item-btn" onClick={() => downloadIcs(exp)}>📅 Recordatorio</button>
              <button className="annual-item-btn danger" onClick={() => setConfirmExp(exp)}>Eliminar</button>
            </div>
          </div>
          )
        })}
      </div>

      {showForm && (
        <Suspense fallback={<FormSkeleton />}>
          <ExpenseFormModal expense={formExpense} onSave={handleSave} onClose={closeForm} />
        </Suspense>
      )}
      {confirmExp && (
        <ConfirmSheet
          title={`¿Eliminar "${confirmExp.nombre}"?`}
          message="Dejarás de recibir avisos y se quitará de tu reparto mensual."
          onCancel={() => setConfirmExp(null)}
          onConfirm={() => handleDelete(confirmExp)}
        />
      )}
    </div>
  )
}
