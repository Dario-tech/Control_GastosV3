import { useState, useMemo } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { fmt } from '../../utils'

const MONTH_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

const FILTERS = [
  { id: 'all',              label: 'Todos'     },
  { id: 'income',           label: 'Ingresos'  },
  { id: 'fixedExpenses',    label: 'Fijos'     },
  { id: 'variableExpenses', label: 'Variables' },
]

export default function TransactionSearchModal({ onClose }) {
  useLockBodyScroll()
  const { transactions } = useFinanceData()
  const [query, setQuery]   = useState('')
  const [filter, setFilter] = useState('all')

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return transactions
      .filter(t => filter === 'all' || t.bucket === filter)
      .filter(t => !q || (t.concepto || '').toLowerCase().includes(q))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [transactions, query, filter])

  const total = results.reduce((s, t) => s + t.importe, 0)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet search-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />

        <div className="search-header">
          <input
            className="search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por concepto…"
            autoFocus
          />
          <button className="search-close" onClick={onClose}>✕</button>
        </div>

        <div className="search-filters">
          {FILTERS.map(f => (
            <button
              key={f.id}
              className={`search-filter-chip${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}
            >{f.label}</button>
          ))}
        </div>

        {results.length === 0 ? (
          <div className="search-empty">Sin resultados</div>
        ) : (
          <div className="search-list">
            {results.map(t => {
              const parts = (t.fecha || '').split('-')
              const day   = parts[2] ?? ''
              const mIdx  = parts[1] ? parseInt(parts[1], 10) - 1 : 0
              const isIncome = t.bucket === 'income'
              return (
                <div key={t.rowIndex} className="search-row">
                  <div className="search-date-block">
                    <span className="search-day">{day}</span>
                    <span className="search-month-short">{MONTH_SHORT[mIdx] ?? ''}</span>
                  </div>
                  <span className="search-concepto">{t.concepto}</span>
                  <span className={`search-importe ${isIncome ? 'pos' : 'neg'}`}>
                    {isIncome ? '+' : '-'}{fmt(t.importe)}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div className="search-footer">
          <span className="search-footer-label">
            {results.length} resultado{results.length !== 1 ? 's' : ''}
          </span>
          <span className="search-footer-total">{fmt(total)}</span>
        </div>
      </div>
    </div>
  )
}
