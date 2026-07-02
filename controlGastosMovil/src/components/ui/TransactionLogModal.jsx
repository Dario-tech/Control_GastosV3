import { useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { deleteTransaction } from '../../services/api'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { fmt } from '../../utils'

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

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

    // Optimistic: borra de la UI al instante
    setDeletedRows(prev => new Set([...prev, rowIndex]))
    setDeleting(rowIndex)

    try {
      await deleteTransaction(rowIndex)
      refresh() // refresca en segundo plano, sin esperar
    } catch (err) {
      // Revertir si falla
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
          <span className="txlog-emoji">{emoji}</span>
          <div>
            <div className="txlog-title">{concept}</div>
            <div className="txlog-subtitle">{MONTH_NAMES[monthIndex]}</div>
          </div>
          <button className="txlog-close" onClick={onClose}>✕</button>
        </div>

        {rows.length === 0 ? (
          <div className="txlog-empty">No hay transacciones registradas</div>
        ) : (
          <div className="txlog-list">
            {rows.map(t => (
              <div key={t.rowIndex} className="txlog-row">
                <div className="txlog-row-info">
                  <span className="txlog-fecha">{t.fecha.slice(5).replace('-', '/')}</span>
                  <span className="txlog-concepto">{t.concepto}</span>
                </div>
                <span className="txlog-importe">{fmt(t.importe)}</span>
                <button
                  className={`txlog-delete-btn ${deleting === t.rowIndex ? 'loading' : ''}`}
                  onClick={() => handleDelete(t.rowIndex)}
                  disabled={!!deleting}
                  aria-label="Eliminar"
                >
                  {deleting === t.rowIndex ? '…' : '🗑'}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="txlog-footer">
          <span className="txlog-footer-label">Total {MONTH_NAMES[monthIndex]}</span>
          <span className="txlog-footer-total">{fmt(total)}</span>
        </div>

      </div>
    </div>
  )
}
