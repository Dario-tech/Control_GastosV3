import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { fmt } from '../../utils'

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]
const DOW_NAMES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']

export default function DaySummaryModal({ day, monthIndex, year, transactions, onClose }) {
  useLockBodyScroll()

  const total = transactions.reduce((s, t) => s + t.importe, 0)
  const date  = new Date(year, monthIndex, day)
  const dow   = DOW_NAMES[date.getDay()]

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
          {transactions.map((t, i) => (
            <div key={t.rowIndex ?? i} className="txlog-row">
              <div className="txlog-row-info">
                <span className="txlog-concepto">{t.concepto}</span>
              </div>
              <span className="txlog-importe">-{fmt(t.importe)}</span>
            </div>
          ))}
        </div>

        <div className="txlog-footer">
          <span className="txlog-footer-label">Total del día</span>
          <span className="txlog-footer-total">-{fmt(total)}</span>
        </div>

      </div>
    </div>
  )
}
