import { useState, useEffect } from 'react'
import { useBudget } from '../../hooks/useBudget'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useApp } from '../../context/AppContext'
import { useSettings } from '../../context/SettingsContext'
import BudgetModal from '../ui/BudgetModal'
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

/* ── Hero total mensual ── */
function TotalHero({ totalLimit, totalSpent, month, daysLeft }) {
  const pct       = totalLimit > 0 ? Math.min(100, (totalSpent / totalLimit) * 100) : 0
  const remaining = totalLimit - totalSpent
  const over      = remaining < 0

  return (
    <div className="bgt-hero">
      <div className="bgt-hero-top">
        <div className="bgt-hero-left">
          <span className="bgt-hero-title">Total Mensual</span>
          <span className="bgt-hero-month">{MONTH_NAMES[month]}</span>
        </div>
        <div className="bgt-hero-right">
          {daysLeft > 0 && <span className="bgt-days-badge">{daysLeft}d restantes</span>}
          <span className="bgt-hero-amount">{fmt(totalLimit)}</span>
        </div>
      </div>

      <div className="bgt-bar-bg">
        <div
          className="bgt-bar-fill"
          style={{ width: `${pct}%`, background: over ? 'var(--red)' : 'var(--text3)' }}
        />
      </div>

      <div className="bgt-bar-footer">
        <span className="bgt-pct-label">Gastado {Math.round(pct)}%</span>
        <span className={`bgt-rem-label ${over ? 'over' : ''}`}>
          {over
            ? `${fmt(-remaining)} excedido`
            : `${fmt(remaining)} restantes este mes`}
        </span>
      </div>
    </div>
  )
}

/* ── Ítem de categoría ── */
function BudgetItem({ item, spent, daysLeft, onEdit }) {
  const pct       = item.limit > 0 ? Math.min(100, (spent / item.limit) * 100) : 0
  const remaining = item.limit - spent
  const over      = remaining < 0
  const color     = item.color || 'var(--accent)'

  return (
    <div className="bgt-item" onClick={onEdit}>
      <div className="bgt-item-top">
        <div className="bgt-item-left">
          <span className="bgt-item-emoji">{item.emoji}</span>
          <span className="bgt-item-name">{item.name}</span>
        </div>
        <div className="bgt-item-right">
          {daysLeft > 0 && <span className="bgt-days-badge">{daysLeft}d restantes</span>}
          <span className="bgt-item-amount">{fmt(item.limit)}</span>
        </div>
      </div>

      <div className="bgt-bar-bg">
        <div
          className="bgt-bar-fill"
          style={{
            width: `${pct}%`,
            background: over ? 'var(--red)' : color,
            boxShadow: over ? 'none' : `0 0 8px ${color}55`,
          }}
        />
      </div>

      <div className="bgt-bar-footer">
        <span className="bgt-pct-label">Gastado {Math.round(pct)}%</span>
        <span className={`bgt-rem-label ${over ? 'over' : ''}`}>
          {over
            ? `${fmt(-remaining)} excedido`
            : `${fmt(remaining)} restantes este mes`}
        </span>
      </div>
    </div>
  )
}

/* ── Tab principal ── */
export default function BudgetTab() {
  const { items, addItem, updateItem, removeItem } = useBudget()
  const { data } = useFinanceData()
  const { selectedMonth } = useApp()
  const { settings } = useSettings()
  const [showModal, setShowModal] = useState(false)
  const [editItem,  setEditItem]  = useState(null)
  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  )

  const days = daysLeftInMonth(selectedMonth)

  function getRealSpent(name) {
    const key = name.toLowerCase().trim()
    const match = [...(data.variableExpenses || []), ...(data.fixedExpenses || [])]
      .find(e => e.concept.toLowerCase().trim() === key)
    return match ? (match.amounts[selectedMonth] ?? 0) : 0
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
    if (!settings.budgetAlerts) return
    if (notifPermission !== 'granted') return
    const cache = getNotifCache()
    let changed = false
    items.forEach(item => {
      const spent     = getRealSpent(item.name)
      const pct       = item.limit > 0 ? (spent / item.limit) * 100 : 0
      const cacheKey  = `${item.id}-${selectedMonth}`
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
  }, [data, items, selectedMonth, settings.budgetAlerts, settings.alertThreshold, notifPermission])

  const itemsWithSpent = items.map(item => ({ ...item, realSpent: getRealSpent(item.name) }))
  const totalLimit     = items.reduce((s, i) => s + (i.limit || 0), 0)
  const totalSpent     = itemsWithSpent.reduce((s, i) => s + i.realSpent, 0)

  function openAdd()      { setEditItem(null);  setShowModal(true) }
  function openEdit(item) { setEditItem(item);  setShowModal(true) }
  function closeModal()   { setShowModal(false); setEditItem(null) }

  function handleSave(formData) {
    if (editItem) updateItem(editItem.id, formData)
    else          addItem(formData)
    closeModal()
  }
  function handleDelete() {
    if (editItem) removeItem(editItem.id)
    closeModal()
  }

  return (
    <div className="tab-panel budget-tab">

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
          <TotalHero
            totalLimit={totalLimit}
            totalSpent={totalSpent}
            month={selectedMonth}
            daysLeft={days}
          />

          <div className="bgt-list">
            {itemsWithSpent.map(item => (
              <BudgetItem
                key={item.id}
                item={item}
                spent={item.realSpent}
                daysLeft={days}
                onEdit={() => openEdit(item)}
              />
            ))}
          </div>

          <button className="budget-fab" onClick={openAdd}>
            Crear Nuevo Presupuesto
          </button>
        </>
      )}

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
