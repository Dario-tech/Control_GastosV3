import { useEffect, useMemo, useRef, useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useApp } from '../../context/AppContext'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { fmt } from '../../utils'
import { MONTH_NAMES } from '../../data/mockData'
import {
  filterCategoryMonth, groupByDay, summarize, prevMonthOf, dayLabel, applyUpdate, localISODate,
} from '../../utils/txlog'
import { useFocusTrap, Icon } from './FormKit'
import TransactionEditModal from './TransactionEditModal'

function money(n) {
  const v = Math.abs(n)
  return fmt(v, Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2)
}

/**
 * Detalle de una categoría en un mes: resumen (total, nº, media y comparación
 * con el mes anterior), lista agrupada por día (más reciente primero) y editor
 * al tocar una fila. Las ediciones se aplican al momento en local y después
 * se refresca /api/finance, así que si un movimiento cambia de mes o de
 * categoría desaparece de esta lista sin esperar a la red.
 */
export default function TransactionLogModal({ concept, emoji, monthIndex, year, onClose }) {
  useLockBodyScroll()
  const { transactions, refresh } = useFinanceData()
  const { showToast } = useApp() || {}
  const [overrides, setOverrides] = useState({})       // rowIndex → tx editada (hasta que llegue el refresh)
  const [deleted, setDeleted]     = useState(() => new Set())
  const [editing, setEditing]     = useState(null)     // tx que se está editando

  // Datos nuevos del servidor (refresh tras guardar, SSE…) mandan sobre los
  // cambios locales provisionales.
  useEffect(() => { setOverrides({}); setDeleted(new Set()) }, [transactions])

  const ref = useRef(null)
  const scrollRef  = useRef(null)
  const summaryRef = useRef(null)
  // Barra compacta con el total cuando el resumen sale de la vista (listas largas).
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const root = scrollRef.current, target = summaryRef.current
    if (!root || !target || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { root, threshold: 0 })
    io.observe(target)
    return () => io.disconnect()
  }, [])
  const editingRef = useRef(editing)
  editingRef.current = editing
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useFocusTrap(ref)

  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    const onKey = e => { if (e.key === 'Escape' && !editingRef.current) closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const all = useMemo(
    () => (transactions || [])
      .filter(t => !deleted.has(t.rowIndex))
      .map(t => overrides[t.rowIndex] ?? t),
    [transactions, overrides, deleted],
  )

  const rows   = useMemo(() => filterCategoryMonth(all, concept, monthIndex, year), [all, concept, monthIndex, year])
  const prev   = prevMonthOf(monthIndex, year || new Date().getFullYear())
  const prevRows = useMemo(
    () => filterCategoryMonth(all, concept, prev.month, year ? prev.year : null),
    [all, concept, prev.month, prev.year, year],
  )
  const groups = useMemo(() => groupByDay(rows), [rows])
  const sum    = summarize(rows, prevRows)
  const today  = localISODate()

  // Ingresos en verde y con "+"; gastos en rojo y con "−". La categoría es
  // homogénea (mismo concepto), así que el primer movimiento decide el tono.
  const isIncome = (rows[0] ?? prevRows[0])?.bucket === 'income'
  const sign = isIncome ? '+' : '−'
  // Para gastos, gastar más que el mes anterior es "malo"; para ingresos, al revés.
  const trendBad = sum.diff != null && sum.diff !== 0 && ((sum.diff > 0) !== isIncome)
  const monthName = MONTH_NAMES[monthIndex]
  const prevName  = MONTH_NAMES[prev.month]

  function backToList() {
    setEditing(null)
    // Si la fila que abrió el editor ya no existe (se movió o se borró), el
    // foco vuelve a la hoja en vez de perderse en <body>.
    requestAnimationFrame(() => {
      if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true })
    })
  }

  function handleSaved(res, patch) {
    const original = editing
    const updated  = applyUpdate(original, res)
    setOverrides(o => ({ ...o, [original.rowIndex]: updated }))
    const movedMonth = updated.month !== original.month || String(updated.fecha).slice(0, 4) !== String(original.fecha).slice(0, 4)
    const movedCat   = updated.concepto !== original.concepto
    if (movedMonth || movedCat) {
      const dest = [movedCat && updated.concepto, movedMonth && MONTH_NAMES[updated.month]?.toLowerCase()].filter(Boolean).join(' · ')
      showToast?.(`✓ Movimiento movido a ${dest}`)
    } else {
      showToast?.(patch.comentario === '' && Object.keys(patch).length === 1 ? '✓ Comentario borrado' : '✓ Cambios guardados')
    }
    backToList()
    refresh()
  }

  function handleDeleted(rowIndex) {
    setDeleted(prevSet => new Set([...prevSet, rowIndex]))
    showToast?.('🗑 Movimiento eliminado')
    backToList()
    refresh()
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} inert={editing ? '' : undefined}>
        <div
          className="modal-sheet txlog-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="txlog-title"
          tabIndex={-1}
          ref={ref}
          onClick={e => e.stopPropagation()}
        >
          <div className="modal-drag-handle" aria-hidden="true" />

          <div className="txlog-header">
            <div className="txlog-icon-wrap" aria-hidden="true">{emoji}</div>
            <div className="txlog-header-text">
              <h2 className="txlog-title" id="txlog-title">{concept}</h2>
              <div className="txlog-subtitle">{monthName}{year ? ` ${year}` : ''}</div>
            </div>
            <button type="button" className="txlog-close" onClick={onClose} aria-label="Cerrar detalle">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="txlog-scroll" ref={scrollRef}>
            <div className={`txlog-sticky${compact ? ' show' : ''}`} aria-hidden={!compact}>
              <div className="txlog-sticky-bar">
                <span>Total {monthName.toLowerCase()} · {sum.count} mov.</span>
                <span className={`txlog-sticky-total ${isIncome ? 'is-income' : ''}`}>
                  {sum.count ? sign : ''}{money(sum.total)}
                </span>
              </div>
            </div>
            <section className="txlog-summary" aria-label="Resumen del mes" ref={summaryRef}>
              <div className="txlog-summary-main">
                <span className="txlog-summary-label">Total {monthName.toLowerCase()}</span>
                <span className={`txlog-summary-total ${isIncome ? 'is-income' : ''}`}>
                  {sum.count ? sign : ''}{money(sum.total)}
                </span>
              </div>
              <div className="txlog-summary-stats">
                <div className="txlog-stat">
                  <span className="txlog-stat-value">{sum.count}</span>
                  <span className="txlog-stat-label">movimiento{sum.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="txlog-stat">
                  <span className="txlog-stat-value">{sum.count ? money(sum.avg) : '—'}</span>
                  <span className="txlog-stat-label">media</span>
                </div>
                <div className="txlog-stat">
                  {sum.diff == null ? (
                    <>
                      <span className="txlog-stat-value txlog-muted">—</span>
                      <span className="txlog-stat-label">sin datos en {prevName.toLowerCase()}</span>
                    </>
                  ) : (
                    <>
                      <span className={`txlog-stat-value txlog-trend ${sum.diff === 0 ? '' : trendBad ? 'bad' : 'good'}`}>
                        {sum.diff === 0 ? '=' : (sum.diff > 0 ? '▲ ' : '▼ ')}
                        {sum.diff === 0 ? '' : `${Math.abs(sum.pct)}%`}
                      </span>
                      <span className="txlog-stat-label">
                        vs {prevName.toLowerCase()} ({money(sum.prevTotal)})
                      </span>
                    </>
                  )}
                </div>
              </div>
            </section>

            {rows.length === 0 ? (
              <div className="txlog-empty">No hay movimientos en {monthName.toLowerCase()}</div>
            ) : (
              <>
                <p className="txlog-tip">Toca un movimiento para editarlo</p>
                <ul className="txlog-days" aria-label="Movimientos">
                  {groups.map(g => {
                    const d = dayLabel(g.fecha, today)
                    return (
                      <li key={g.fecha} className="txlog-day-group">
                        <div className="txlog-date-block" aria-hidden="true">
                          <span className="txlog-day">{d.day}</span>
                          <span className="txlog-weekday">{d.weekday}</span>
                        </div>
                        <ul className="txlog-day-items">
                          {g.items.map(t => (
                            <li key={t.rowIndex}>
                              <button
                                type="button"
                                className="txlog-row"
                                onClick={() => setEditing(t)}
                                aria-label={`Editar movimiento de ${money(t.importe)}, ${d.long}${t.comentario ? `, nota: ${t.comentario}` : ''}`}
                              >
                                <span className={`txlog-note${t.comentario ? '' : ' empty'}`}>
                                  {t.comentario || 'Sin nota'}
                                </span>
                                <span className={`txlog-importe ${isIncome ? 'is-income' : ''}`}>{sign}{money(t.importe)}</span>
                                <span className="txlog-chevron" aria-hidden="true"><Icon name="back" size={16} /></span>
                              </button>
                            </li>
                          ))}
                          {g.items.length > 1 && (
                            <li className="txlog-day-total" aria-label={`Total del día ${money(g.total)}`}>
                              <span>{g.items.length} movimientos</span>
                              <span>{sign}{money(g.total)}</span>
                            </li>
                          )}
                        </ul>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <TransactionEditModal
          tx={editing}
          emoji={emoji}
          onClose={backToList}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </>
  )
}
