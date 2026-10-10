import { useState, useEffect } from 'react'
import { useBudget } from '../../hooks/useBudget'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useApp } from '../../context/AppContext'
import { useSettings } from '../../context/SettingsContext'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import MonthYearSheet from '../ui/MonthYearSheet'
import BudgetModal from '../ui/BudgetModal'
import SavingsGoals from '../ui/SavingsGoals'
import AnnualExpenses from '../ui/AnnualExpenses'
import { fmt } from '../../utils'

const NOTIF_LS_KEY = 'mi-economia-notif-v1'
function getNotifCache() {
  try { return JSON.parse(localStorage.getItem(NOTIF_LS_KEY) || '{}') }
  catch { return {} }
}
function setNotifCache(cache) {
  localStorage.setItem(NOTIF_LS_KEY, JSON.stringify(cache))
}

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

function daysLeftInMonth(monthIndex) {
  const now = new Date()
  if (now.getMonth() !== monthIndex) return 0
  const lastDay = new Date(now.getFullYear(), monthIndex + 1, 0).getDate()
  return lastDay - now.getDate()
}

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

/* ── Estados visuales: color + icono + texto ── */
const STATUS = {
  ok:   { icon: '✓', label: 'En orden' },
  warn: { icon: '!', label: 'Cerca del límite' },
  over: { icon: '✕', label: 'Superado' },
}
function statusOf(spent, limit, threshold) {
  if (limit > 0 && spent > limit) return 'over'
  if (limit > 0 && (spent / limit) * 100 >= threshold) return 'warn'
  return 'ok'
}

/* ── Hero total mensual ── */
function TotalHero({ totalLimit, totalSpent, daysLeft, threshold }) {
  const rawPct    = totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0
  const pct       = Math.min(100, rawPct)
  const remaining = totalLimit - totalSpent
  const over      = remaining < 0
  const st        = statusOf(totalSpent, totalLimit, threshold)
  const pace      = !over && daysLeft > 0 ? remaining / daysLeft : null

  return (
    <div className={`bgt-hero bgt-st-${st}`}>
      <div className="bgt-hero-top">
        <div className="bgt-hero-left">
          <span className="bgt-hero-title">Total mensual</span>
          <span className="bgt-hero-sub tabular">{fmt(totalSpent)} de {fmt(totalLimit)}</span>
        </div>
        {daysLeft > 0 && <span className="bgt-days-badge">{daysLeft}d restantes</span>}
      </div>

      <div className="bgt-hero-main">
        <span className="bgt-hero-remaining tabular">{fmt(Math.abs(remaining))}</span>
        <span className="bgt-hero-remaining-label">{over ? 'excedido' : 'restantes'}</span>
      </div>

      <div className="bgt-bar-bg bgt-bar-bg--lg" role="progressbar" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={Math.round(rawPct)} aria-label="Gastado del presupuesto total">
        <div className="bgt-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="bgt-bar-footer">
        <span className="bgt-pct-label">Gastado {Math.round(rawPct)}%</span>
        <span className="bgt-status-chip"><span aria-hidden="true">{STATUS[st].icon}</span>{STATUS[st].label}</span>
      </div>
      {pace != null && (
        <div className="bgt-pace tabular">Ritmo sugerido: {fmt(pace)} al día</div>
      )}
    </div>
  )
}

/* ── Ítem de categoría ── */
function BudgetItem({ item, spent, threshold, onEdit }) {
  const rawPct    = item.limit > 0 ? (spent / item.limit) * 100 : 0
  const pct       = Math.min(100, rawPct)
  const remaining = item.limit - spent
  const over      = remaining < 0
  const st        = statusOf(spent, item.limit, threshold)
  const color     = item.color || 'var(--accent)'

  return (
    <div className={`bgt-item bgt-st-${st}`} onClick={onEdit}>
      <div className="bgt-item-top">
        <div className="bgt-item-left">
          <span className="bgt-item-emoji">{item.emoji}</span>
          <div className="bgt-item-titles">
            <span className="bgt-item-name">{item.name}</span>
            <span className="bgt-item-sub tabular">{fmt(spent)} / {fmt(item.limit)}</span>
          </div>
        </div>
        <span className="bgt-item-pct tabular">{Math.round(rawPct)}%</span>
      </div>

      <div className="bgt-bar-bg" role="progressbar" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={Math.round(rawPct)} aria-label={`Gastado en ${item.name}`}>
        <div
          className="bgt-bar-fill"
          style={{
            width: `${pct}%`,
            '--bar-color': over ? 'var(--red)' : color,
          }}
        />
      </div>

      <div className="bgt-bar-footer">
        <span className="bgt-status-chip"><span aria-hidden="true">{STATUS[st].icon}</span>{STATUS[st].label}</span>
        <span className="bgt-rem-label tabular">
          {over ? `Excedido ${fmt(-remaining)}` : `Quedan ${fmt(remaining)}`}
        </span>
      </div>
    </div>
  )
}

/* ── Tab principal ── */
export default function BudgetTab() {
  const { itemsForMonth, addItem, updateItem, removeItem } = useBudget()
  const { data } = useFinanceData()
  const { selectedMonth: globalMonth } = useApp()
  const { settings } = useSettings()

  // Mes local — independiente del selector global
  const [budgetMonth, setBudgetMonth]         = useState(globalMonth)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [showModal, setShowModal]             = useState(false)
  const [editItem,  setEditItem]              = useState(null)
  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  )

  // items del mes seleccionado — DESPUÉS de declarar budgetMonth
  const items = itemsForMonth(budgetMonth)

  const days = daysLeftInMonth(budgetMonth)

  function getRealSpent(name) {
    const key = name.toLowerCase().trim()
    const match = [...(data.variableExpenses || []), ...(data.fixedExpenses || [])]
      .find(e => e.concept.toLowerCase().trim() === key)
    return match ? (match.amounts[budgetMonth] ?? 0) : 0
  }

  async function requestNotifPermission() {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      requestNotifPermission()
    }
  }, [])

  useEffect(() => {
    if (!settings.budgetAlerts || notifPermission !== 'granted') return
    const cache = getNotifCache()
    let changed = false
    items.forEach(item => {
      const spent     = getRealSpent(item.name)
      const pct       = item.limit > 0 ? (spent / item.limit) * 100 : 0
      const cacheKey  = `${item.id}-${budgetMonth}`
      const lastSpent = cache[cacheKey] ?? 0
      if (spent !== lastSpent) {
        cache[cacheKey] = spent
        changed = true
        const threshold = (settings.alertThreshold / 100) * item.limit
        if (spent >= threshold && lastSpent < threshold) {
          new Notification(`⚠️ Presupuesto: ${item.emoji} ${item.name}`, {
            body: `Has gastado el ${Math.round(pct)}% de tu límite (${fmt(spent)} de ${fmt(item.limit)})`,
            icon: '/icons/icon-192.png',
            tag: cacheKey,
          })
        }
      }
    })
    if (changed) setNotifCache(cache)
  }, [data, items, budgetMonth, settings.budgetAlerts, settings.alertThreshold, notifPermission])

  const itemsWithSpent = items.map(item => ({ ...item, realSpent: getRealSpent(item.name) }))
  // Más consumido primero (los superados quedan arriba)
  const sortedItems    = [...itemsWithSpent].sort((a, b) =>
    (b.limit > 0 ? b.realSpent / b.limit : 0) - (a.limit > 0 ? a.realSpent / a.limit : 0))
  const totalLimit     = items.reduce((s, i) => s + (i.limit || 0), 0)
  const totalSpent     = itemsWithSpent.reduce((s, i) => s + i.realSpent, 0)

  function openAdd()      { setEditItem(null);  setShowModal(true) }
  function openEdit(item) { setEditItem(item);  setShowModal(true) }
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

          <button className="budget-fab" onClick={openAdd}>
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
      <SavingsGoals alignRight />

      {/* Month picker */}
      {showMonthPicker && (
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
      )}

      {/* Budget modal */}
      {showModal && (
        <BudgetModal
          item={editItem}
          onSave={handleSave}
          onClose={closeModal}
          onDelete={editItem ? handleDelete : null}
        />
      )}
    </div>
  )
}
