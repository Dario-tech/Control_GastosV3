import { lazy, Suspense, useState } from 'react'
import { useBudget } from '../../hooks/useBudget'
import { useBudgetAlerts } from '../../hooks/useBudgetAlerts'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useApp } from '../../context/AppContext'
import { useSettings } from '../../context/SettingsContext'
import TotalHero from '../ui/budget/TotalHero'
import BudgetItem from '../ui/budget/BudgetItem'
import SavingsGoals from '../ui/SavingsGoals'
import AnnualExpenses from '../ui/AnnualExpenses'
import { FormSkeleton } from '../ui/Skeleton'
import { MONTH_NAMES } from '../../data/mockData'
import { daysLeftInMonth } from '../../utils/budget'

// Hoja de mes y formulario de presupuesto: solo se cargan al abrirlos.
const MonthYearSheet = lazy(() => import('../ui/MonthYearSheet'))
const BudgetModal    = lazy(() => import('../ui/BudgetModal'))

/* ── Estado vacío ── */
function EmptyState({ onAdd }) {
  return (
    <div className="budget-empty">
      <div className="budget-empty-icon">🎯</div>
      <h2 className="budget-empty-title">Sin presupuesto</h2>
      <p className="budget-empty-desc">
        Crea categorías de presupuesto y la app calculará automáticamente cuánto llevas gastado
        según tus transacciones reales.
      </p>
      <button className="budget-fab" onClick={onAdd}>
        Crear Nuevo Presupuesto
      </button>
    </div>
  )
}

/* ── Tab principal ── */
export default function BudgetTab() {
  const { itemsForMonth, addItem, updateItem, removeItem } = useBudget()
  const { data } = useFinanceData()
  const { selectedMonth: globalMonth } = useApp()
  const { settings, budgetsLocked } = useSettings()

  // Mes local — independiente del selector global
  const [budgetMonth, setBudgetMonth]         = useState(globalMonth)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [showModal, setShowModal]             = useState(false)
  const [editItem,  setEditItem]              = useState(null)

  // items del mes seleccionado — DESPUÉS de declarar budgetMonth
  const items = itemsForMonth(budgetMonth)

  const days = daysLeftInMonth(budgetMonth)

  function getRealSpent(name) {
    const key = name.toLowerCase().trim()
    const match = [...(data.variableExpenses || []), ...(data.fixedExpenses || [])]
      .find(e => e.concept.toLowerCase().trim() === key)
    return match ? (match.amounts[budgetMonth] ?? 0) : 0
  }

  const { notifPermission, requestNotifPermission } = useBudgetAlerts({ items, getRealSpent, month: budgetMonth, data })

  const itemsWithSpent = items.map(item => ({ ...item, realSpent: getRealSpent(item.name) }))
  // Más consumido primero (los superados quedan arriba)
  const sortedItems    = [...itemsWithSpent].sort((a, b) =>
    (b.limit > 0 ? b.realSpent / b.limit : 0) - (a.limit > 0 ? a.realSpent / a.limit : 0))
  const totalLimit     = items.reduce((s, i) => s + (i.limit || 0), 0)
  const totalSpent     = itemsWithSpent.reduce((s, i) => s + i.realSpent, 0)

  function openAdd()      { if (budgetsLocked) return; setEditItem(null);  setShowModal(true) }
  function openEdit(item) { if (budgetsLocked) return; setEditItem(item);  setShowModal(true) }
  function closeModal()   { setShowModal(false); setEditItem(null) }

  function handleSave(formData) {
    if (editItem) updateItem(editItem.id, formData)
    else          addItem(formData, budgetMonth)
    closeModal()
  }
  function handleDelete() {
    if (editItem) removeItem(editItem.id)
    closeModal()
  }

  return (
    <div className="tab-panel budget-tab">

      {/* Sub-header con selector de mes — solo afecta a esta sección de
          presupuestos por categoría, no a los gastos fijos ni a las metas de
          más abajo (cada bloque es independiente). */}
      <div className="bgt-subheader">
        <span className="bgt-subheader-title">Presupuestos por categoría</span>
        <button className="bgt-month-btn" onClick={() => setShowMonthPicker(true)}>
          {MONTH_NAMES[budgetMonth]}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M4 6l4 4 4-4"/>
          </svg>
        </button>
      </div>

      {/* Banners de notificación */}
      {settings.budgetAlerts && notifPermission === 'default' && (
        <button className="notif-banner" onClick={requestNotifPermission}>
          <span>🔔</span>
          <span>Activa las notificaciones para recibir alertas de gasto</span>
          <span className="notif-banner-cta">Activar →</span>
        </button>
      )}
      {settings.budgetAlerts && notifPermission === 'denied' && (
        <div className="notif-banner notif-banner--denied">
          <span>🔕</span>
          <span>Notificaciones bloqueadas — actívalas en la configuración del navegador</span>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState onAdd={openAdd} />
      ) : (
        <>
          <TotalHero totalLimit={totalLimit} totalSpent={totalSpent} daysLeft={days} threshold={settings.alertThreshold} />

          <div className="bgt-list">
            {sortedItems.map(item => (
              <BudgetItem
                key={item.id}
                item={item}
                spent={item.realSpent}
                threshold={settings.alertThreshold}
                onEdit={() => openEdit(item)}
              />
            ))}
          </div>

          <button className="budget-fab" onClick={openAdd} disabled={budgetsLocked}>
            Crear Nuevo Presupuesto
          </button>
        </>
      )}

      {/* Gastos fijos anuales: IBI, seguro del coche… — bloque independiente
          del presupuesto por categoría de arriba, separado visualmente para
          que no se lean como una sola cosa continua. */}
      <div className="planning-section-divider" />
      <AnnualExpenses />

      {/* Metas de ahorro: aquí vive la gestión completa (crear, editar, compartir…) */}
      <div className="planning-section-divider" />
      <SavingsGoals />

      {/* Month picker */}
      {showMonthPicker && (
        <Suspense fallback={null}>
          <MonthYearSheet
            hideYear
            title="Mes del presupuesto"
            year={new Date().getFullYear()}
            month={budgetMonth}
            minYear={new Date().getFullYear()}
            maxYear={new Date().getFullYear()}
            hasData={(y, m) => !!data.activeMonths?.[m]}
            onSelect={m => setBudgetMonth(m)}
            onClose={() => setShowMonthPicker(false)}
          />
        </Suspense>
      )}

      {/* Budget modal */}
      {showModal && (
        <Suspense fallback={<FormSkeleton />}>
          <BudgetModal
            item={editItem}
            onSave={handleSave}
            onClose={closeModal}
            onDelete={editItem ? handleDelete : null}
          />
        </Suspense>
      )}
    </div>
  )
}
