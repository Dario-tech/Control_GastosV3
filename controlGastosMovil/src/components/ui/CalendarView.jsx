import { useState, useEffect } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { fmt } from '../../utils'
import { MONTH_NAMES } from '../../data/mockData'

/* CALENDARIO DE CALOR (aislado: borrar este archivo + la sección CSS
   "CALENDARIO DE CALOR" de App.css + su única línea en MonthTab.jsx).
   Cada día es un anillo cuyo arco crece con el gasto del día; punto verde =
   ingreso, rombo = vencimiento de gasto fijo anual. Tocar un día abre un panel
   de cristal con su total y movimientos. Sigue el mes/año que le pasan. */
const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DOW_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export default function CalendarView({ monthIndex, year, annualExpenses = [] }) {
  const { transactions } = useFinanceData()
  const [sel, setSel] = useState(null)
  useEffect(() => { setSel(null) }, [monthIndex, year])

  const byDay = {}
  transactions.forEach(t => {
    if (t.month !== monthIndex) return
    const [y, , d] = String(t.fecha).split('-').map(Number)
    if (y !== year || isNaN(d)) return
    ;(byDay[d] = byDay[d] || []).push(t)
  })
  const sums = day => {
    const ts = byDay[day] || []
    return {
      income:  ts.filter(t => t.bucket === 'income').reduce((s, t) => s + t.importe, 0),
      expense: ts.filter(t => t.bucket !== 'income').reduce((s, t) => s + t.importe, 0),
    }
  }
  const dueOn = day => annualExpenses.filter(e => e.mes - 1 === monthIndex && Number(e.dia) === day)

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const expenses = days.map(d => sums(d).expense)
  const maxExp = Math.max(...expenses, 1)
  const total = expenses.reduce((s, v) => s + v, 0)
  const now = new Date()
  const isCur = now.getFullYear() === year && now.getMonth() === monthIndex
  const elapsed = isCur ? now.getDate() : (new Date(year, monthIndex, 1) < now ? daysInMonth : 0)
  const zeroDays = elapsed > 0 ? days.slice(0, elapsed).filter(d => expenses[d - 1] === 0).length : 0
  const peakIdx = expenses.indexOf(Math.max(...expenses))
  const avg = elapsed > 0 ? total / elapsed : 0

  const selSums = sel ? sums(sel) : null
  const selTx = sel ? (byDay[sel] || []) : []
  const selDue = sel ? dueOn(sel) : []
  const net = selSums ? selSums.income - selSums.expense : 0

  return (
    <div className="cv">
      <div className="cv-stats">
        <div className="cv-stat"><span className="cv-stat-v tabular">{fmt(avg)}</span><span className="cv-stat-l">Media diaria</span></div>
        <div className="cv-stat"><span className="cv-stat-v tabular">{expenses[peakIdx] > 0 ? `${peakIdx + 1} ${MONTH_NAMES[monthIndex].slice(0, 3).toLowerCase()}` : '—'}</span><span className="cv-stat-l">Día más caro</span></div>
        <div className="cv-stat"><span className="cv-stat-v tabular">{zeroDays}</span><span className="cv-stat-l">Días sin gasto</span></div>
      </div>

      <div className="cv-dow" aria-hidden="true">{DOW.map(d => <span key={d}>{d}</span>)}</div>
      <div className="cv-grid" key={`${year}-${monthIndex}`} role="grid" aria-label={`${MONTH_NAMES[monthIndex]} ${year}`}>
        {Array.from({ length: offset }, (_, i) => <span key={`e${i}`} className="cv-empty" />)}
        {days.map(day => {
          const { income, expense } = sums(day)
          const k = expense > 0 ? Math.max(0.12, expense / maxExp) : 0
          const due = dueOn(day).length > 0
          const label = [`${day} de ${MONTH_NAMES[monthIndex]}`,
            expense > 0 && `gastos ${fmt(expense)}`, income > 0 && `ingresos ${fmt(income)}`,
            due && 'vence un gasto fijo'].filter(Boolean).join(', ')
          return (
            <button
              key={day}
              type="button"
              aria-pressed={sel === day}
              aria-label={label}
              aria-current={isCur && now.getDate() === day ? 'date' : undefined}
              className={`cv-day${sel === day ? ' sel' : ''}${isCur && now.getDate() === day ? ' today' : ''}${expense > 0 ? ' hot' : ''}`}
              style={{ '--k': k, '--i': day }}
              onClick={() => setSel(s => (s === day ? null : day))}
            >
              <svg className="cv-ring" viewBox="0 0 44 44" aria-hidden="true">
                <circle className="cv-ring-track" cx="22" cy="22" r="18.5" />
                {k > 0 && <circle className="cv-ring-arc" cx="22" cy="22" r="18.5" pathLength="100" style={{ strokeDashoffset: 100 - k * 100 }} />}
              </svg>
              <span className="cv-num">{day}</span>
              {income > 0 && <i className="cv-inc" aria-hidden="true" />}
              {due && <i className="cv-due" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <div className="cv-legend" aria-hidden="true">
        <span><i className="cv-key arc" />Gasto (arco)</span>
        <span><i className="cv-key inc" />Ingreso</span>
        <span><i className="cv-key due" />Vencimiento</span>
      </div>

      {sel && (
        <div className="cv-panel" role="region" aria-live="polite" aria-label={`Día ${sel}`}>
          <div className="cv-panel-head">
            <div>
              <div className="cv-panel-title">{sel} de {MONTH_NAMES[monthIndex]}</div>
              <div className="cv-panel-sub">{DOW_LONG[new Date(year, monthIndex, sel).getDay()]}</div>
            </div>
            <div className={`cv-panel-total tabular${net > 0 ? ' pos' : net < 0 ? ' neg' : ''}`}>
              {net === 0 ? fmt(0) : `${net > 0 ? '+' : '−'}${fmt(Math.abs(net))}`}
              <span>Total del día</span>
            </div>
          </div>
          {selTx.length === 0 && selDue.length === 0 ? (
            <p className="cv-empty-msg">Sin movimientos este día.</p>
          ) : (
            <div className="cv-list">
              {selDue.map(e => (
                <div key={`d${e.id}`} className="cv-row"><i className="cv-due" aria-hidden="true" /><span className="cv-row-name">Vence: {e.nombre}</span><span className="cv-row-amt tabular">{fmt(e.importe)}</span></div>
              ))}
              {selTx.map((t, i) => {
                const inc = t.bucket === 'income'
                return (
                  <div key={t.rowIndex ?? i} className="cv-row">
                    <i className={inc ? 'cv-inc-dot' : 'cv-exp-dot'} aria-hidden="true" />
                    <span className="cv-row-name">{t.concepto}{t.comentario && <small>{t.comentario}</small>}</span>
                    <span className={`cv-row-amt tabular${inc ? ' pos' : ''}`}>{inc ? '+' : '−'}{fmt(t.importe)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
