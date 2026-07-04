import { useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { deleteTransaction } from '../../services/api'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { fmt } from '../../utils'

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]
const MONTH_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

export default function TransactionLogModal({ concept, emoji, monthIndex, onClose }) {
  useLockBodyScroll()
  const { transactions, refresh } = useFinanceData()
  const [deletedRows, setDeletedRows] = useState(new Set())
  const [deleting, setDeleting]       = useState(null)

  const rows = transactions
    .filter(t => t.concepto === concept && t.month === monthIndex && !deletedRows.has(t.rowIndex))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  async function handleDelete(rowIndex) {
    if (deleting) return
    setDeletedRows(prev => new Set([...prev, rowIndex]))
    setDeleting(rowIndex)
    try {
      await deleteTransaction(rowIndex)
      refresh()
    } catch {
      setDeletedRows(prev => { const s = new Set(prev); s.delete(rowIndex); return s })
      alert('No se pudo eliminar. Inténtalo de nuevo.')
    } finally {
      setDeleting(null)
    }
  }

  const total = rows.reduce((s, t) => s + t.importe, 0)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet txlog-sheet" onClick={e => e.stopPropagation()}>

        <div className="modal-drag-handle" />

        <div className="txlog-header">
          <div className="txlog-icon-wrap">{emoji}</div>
          <div className="txlog-header-text">
            <div className="txlog-title">{concept}</div>
            <div className="txlog-subtitle">
              {MONTH_NAMES[monthIndex]}
              {rows.length > 0 && (
                <span className="txlog-count-badge">{rows.length} movimiento{rows.length !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>
          <button className="txlog-close" onClick={onClose}>✕</button>
        </div>

        {rows.length === 0 ? (
          <div className="txlog-empty">No hay transacciones registradas</div>
        ) : (
          <div className="txlog-list">
            {rows.map(t => {
              const parts = t.fecha.split('-')
              const day   = parts[2] ?? ''
              const mIdx  = parts[1] ? parseInt(parts[1], 10) - 1 : monthIndex
              return (
                <div key={t.rowIndex} className="txlog-row">
                  <div className="txlog-date-block">
                    <span className="txlog-day">{day}</span>
                    <span className="txlog-month-short">{MONTH_SHORT[mIdx] ?? ''}</span>
                  </div>
                  <div className="txlog-row-info">
                    <span className="txlog-concepto">{t.concepto}</span>
                  </div>
                  <span className="txlog-importe">-{fmt(t.importe)}</span>
                  <button
                    className={`txlog-delete-btn ${deleting === t.rowIndex ? 'loading' : ''}`}
                    onClick={() => handleDelete(t.rowIndex)}
                    disabled={!!deleting}
                    aria-label="Eliminar"
                  >
                    {deleting === t.rowIndex ? '…' : '🗑'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="txlog-footer">
          <span className="txlog-footer-label">Total {MONTH_NAMES[monthIndex]}</span>
          <span className="txlog-footer-total">-{fmt(total)}</span>
        </div>

      </div>
    </div>
  )
}
