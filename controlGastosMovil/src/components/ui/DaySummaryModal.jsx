import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { fmt } from '../../utils'

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]
const DOW_NAMES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']

export default function DaySummaryModal({ day, monthIndex, year, transactions, onClose }) {
  useLockBodyScroll()

  const income  = transactions.filter(t => t.bucket === 'income').reduce((s, t) => s + t.importe, 0)
  const expense = transactions.filter(t => t.bucket !== 'income').reduce((s, t) => s + t.importe, 0)
  const net     = income - expense
  const date    = new Date(year, monthIndex, day)
  const dow     = DOW_NAMES[date.getDay()]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet txlog-sheet" onClick={e => e.stopPropagation()}>

        <div className="modal-drag-handle" />

        <div className="txlog-header">
          <div className="txlog-icon-wrap">📅</div>
          <div className="txlog-header-text">
            <div className="txlog-title">{day} de {MONTH_NAMES[monthIndex]}</div>
            <div className="txlog-subtitle" style={{ textTransform: 'capitalize' }}>
              {dow}
              <span className="txlog-count-badge">
                {transactions.length} movimiento{transactions.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <button className="txlog-close" onClick={onClose}>✕</button>
        </div>

        <div className="txlog-list">
          {transactions.map((t, i) => {
            const isIncome = t.bucket === 'income'
            return (
              <div key={t.rowIndex ?? i} className="txlog-row">
                <div className="txlog-row-info">
                  <span className="txlog-concepto">{t.concepto}</span>
                </div>
                <span className="txlog-importe" style={isIncome ? { color: 'var(--green)' } : undefined}>
                  {isIncome ? '+' : '-'}{fmt(t.importe)}
                </span>
              </div>
            )
          })}
        </div>

        <div className="txlog-footer">
          <span className="txlog-footer-label">Total del día</span>
          <span className="txlog-footer-total" style={net >= 0 ? { color: 'var(--green)' } : undefined}>
            {net >= 0 ? '+' : '-'}{fmt(Math.abs(net))}
          </span>
        </div>

      </div>
    </div>
  )
}
