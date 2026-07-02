import { useState, useEffect } from 'react'

const NOTIF_LS_KEY = 'mi-economia-notif-v1'

function getNotifCache() {
  try { return JSON.parse(localStorage.getItem(NOTIF_LS_KEY) || '{}') }
  catch { return {} }
}
function setNotifCache(cache) {
  localStorage.setItem(NOTIF_LS_KEY, JSON.stringify(cache))
}
import { useBudget } from '../../hooks/useBudget'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useApp } from '../../context/AppContext'
import { useSettings } from '../../context/SettingsContext'
import BudgetModal from '../ui/BudgetModal'
import { fmt } from '../../utils'

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

function pctColor(pct) {
  if (pct >= 100) return 'var(--red)'
  if (pct >= 80)  return 'var(--orange)'
  if (pct >= 60)  return '#f59e0b'
  return 'var(--green)'
}

function EmptyState({ onAdd }) {
  return (
    <div className="budget-empty">
      <div className="budget-empty-icon">🎯</div>
      <h2 className="budget-empty-title">Sin presupuesto</h2>
      <p className="budget-empty-desc">
        Crea categorías de presupuesto y la app calculará automáticamente cuánto llevas gastado
        según tus transacciones reales.
      </p>
      <button className="budget-create-btn" onClick={onAdd}>
        + Crear presupuesto
      </button>
    </div>
  )
}

function OverallHero({ totalLimit, totalSpent, month }) {
  const pct       = totalLimit > 0 ? Math.min(100, Math.round((totalSpent / totalLimit) * 100)) : 0
  const remaining = totalLimit - totalSpent
  const remPos    = remaining >= 0
  const color     = pctColor(pct)

  return (
    <div className="budget-hero">
      <div className="budget-hero-top">
        <div>
          <div className="budget-hero-label">Presupuesto — {MONTH_NAMES[month]}</div>
          <div className="budget-hero-total">{fmt(totalLimit)}</div>
        </div>
        <div className="budget-hero-pct-block">
          <span className="budget-hero-pct" style={{ color }}>{pct}%</span>
          <span className="budget-hero-pct-label">usado</span>
        </div>
      </div>

      <div className="budget-hero-bar-bg">
        <div className="budget-hero-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>

      <div className="budget-hero-footer">
        <span className="budget-hero-spent">{fmt(totalSpent)} gastados</span>
        <span style={{ color: remPos ? 'var(--green)' : 'var(--red)', fontSize: '0.82rem', fontWeight: 700 }}>
          {remPos ? `${fmt(remaining)} restantes` : `${fmt(-remaining)} excedidos`}
        </span>
      </div>
    </div>
  )
}

function BudgetItem({ item, spent, onEdit }) {
  const pct       = item.limit > 0 ? Math.min(100, Math.round((spent / item.limit) * 100)) : 0
  const remaining = item.limit - spent
  const remPos    = remaining >= 0
  const color     = pctColor(pct)

  return (
    <div className="budget-item" onClick={onEdit}>
      <div className="budget-item-top">
        <div className="budget-item-left">
          <div className="budget-item-icon">{item.emoji}</div>
          <div className="budget-item-info">
            <span className="budget-item-name">{item.name}</span>
            <span className="budget-item-limit">Límite: {fmt(item.limit)} / mes</span>
          </div>
        </div>
        <div className="budget-item-right">
          <span className="budget-item-pct" style={{ color }}>{pct}%</span>
          <span className="budget-item-rem" style={{ color: remPos ? 'var(--text3)' : 'var(--red)' }}>
            {remPos ? `${fmt(remaining)} left` : `${fmt(-remaining)} over`}
          </span>
        </div>
      </div>

      <div className="budget-progress-bg">
        <div className="budget-progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>

      <div className="budget-item-footer">
        <span className="budget-item-footer-label">Gastado este mes</span>
        <span className="budget-item-footer-value">{fmt(spent)}</span>
      </div>
    </div>
  )
}

export default function BudgetTab() {
  const { items, addItem, updateItem, removeItem } = useBudget()
  const { data } = useFinanceData()
  const { selectedMonth } = useApp()
  const { settings } = useSettings()
  const [showModal, setShowModal] = useState(false)
  const [editItem,  setEditItem]  = useState(null)

  // Busca el gasto real de una categoría en variableExpenses del mes actual
  function getRealSpent(name) {
    const key = name.toLowerCase().trim()
    const match = [...(data.variableExpenses || []), ...(data.fixedExpenses || [])]
      .find(e => e.concept.toLowerCase().trim() === key)
    return match ? (match.amounts[selectedMonth] ?? 0) : 0
  }

  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  )

  async function requestNotifPermission() {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }

  // Pedir permiso automáticamente al entrar en Budget
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      requestNotifPermission()
    }
  }, [])

  // Notificar solo cuando el gasto real haya cambiado y supere el umbral
  useEffect(() => {
    if (!settings.budgetAlerts) return
    if (notifPermission !== 'granted') return

    const cache = getNotifCache()
    let changed  = false

    items.forEach(item => {
      const spent     = getRealSpent(item.name)
      const pct       = item.limit > 0 ? (spent / item.limit) * 100 : 0
      const cacheKey  = `${item.id}-${selectedMonth}`
      const lastSpent = cache[cacheKey] ?? 0

      // Solo notifica si el gasto aumentó Y cruza el umbral por primera vez
      if (spent !== lastSpent) {
        cache[cacheKey] = spent
        changed = true

        const thresholdAmount = (settings.alertThreshold / 100) * item.limit
        if (spent >= thresholdAmount && lastSpent < thresholdAmount) {
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

  function openAdd()      { setEditItem(null); setShowModal(true) }
  function openEdit(item) { setEditItem(item); setShowModal(true) }
  function closeModal()   { setShowModal(false); setEditItem(null) }

  function handleSave(data) {
    if (editItem) updateItem(editItem.id, data)
    else          addItem(data)
    closeModal()
  }

  function handleDelete() {
    if (editItem) removeItem(editItem.id)
    closeModal()
  }

  return (
    <div className="tab-panel">

      {/* Banner de permiso de notificaciones */}
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
          <OverallHero totalLimit={totalLimit} totalSpent={totalSpent} month={selectedMonth} />

          <div className="budget-list">
            {itemsWithSpent.map(item => (
              <BudgetItem
                key={item.id}
                item={item}
                spent={item.realSpent}
                onEdit={() => openEdit(item)}
              />
            ))}
          </div>

          <button className="budget-add-row" onClick={openAdd}>
            <span className="budget-add-plus">+</span>
            <span>Añadir categoría</span>
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
