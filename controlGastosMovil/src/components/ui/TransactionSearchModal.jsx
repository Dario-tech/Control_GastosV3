import { useState, useEffect, useRef, useCallback } from 'react'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { searchTransactions } from '../../services/api'
import { fmt } from '../../utils'
import { MONTH_SHORT_LC } from '../../data/mockData'

const FILTERS = [
  { id: 'all',              label: 'Todos'     },
  { id: 'income',           label: 'Ingresos'  },
  { id: 'fixedExpenses',    label: 'Fijos'     },
  { id: 'variableExpenses', label: 'Variables' },
]

export default function TransactionSearchModal({ onClose }) {
  useLockBodyScroll()
  const [query, setQuery]     = useState('')
  const [filter, setFilter]   = useState('all')
  const [results, setResults] = useState([])
  const [nextCursor, setNextCursor]   = useState(null)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState(null)
  const requestId = useRef(0)

  // Busca en el backend desde cero (nueva query o filtro) — paginado, no trae
  // todo el histórico de golpe.
  const runSearch = useCallback(async (q, tipo) => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const { results: page, next_cursor } = await searchTransactions({ q, tipo, limit: 30 })
      if (id !== requestId.current) return // respuesta obsoleta (query cambió mientras esperábamos)
      setResults(page)
      setNextCursor(next_cursor)
    } catch (e) {
      if (id !== requestId.current) return
      setError(e.message || 'No se pudo buscar')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  // Búsqueda inicial (query vacía = últimas transacciones) + debounce al teclear.
  useEffect(() => {
    const t = setTimeout(() => runSearch(query, filter), query ? 350 : 0)
    return () => clearTimeout(t)
  }, [query, filter, runSearch])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const { results: page, next_cursor } = await searchTransactions({
        q: query, tipo: filter, cursor: nextCursor, limit: 30,
      })
      setResults(prev => [...prev, ...page])
      setNextCursor(next_cursor)
    } catch (e) {
      setError(e.message || 'No se pudo cargar más')
    } finally {
      setLoadingMore(false)
    }
  }

  const shownTotal = results.reduce((s, t) => s + t.importe, 0)

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

        {error && <div className="search-empty">{error}</div>}

        {!error && loading && (
          <div className="search-empty">Buscando…</div>
        )}

        {!error && !loading && results.length === 0 && (
          <div className="search-empty">Sin resultados</div>
        )}

        {!error && !loading && results.length > 0 && (
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
                    <span className="search-month-short">{MONTH_SHORT_LC[mIdx] ?? ''}</span>
                  </div>
                  <div className="search-info">
                    <span className="search-concepto">{t.concepto}</span>
                    {t.comentario && <span className="search-comentario">💬 {t.comentario}</span>}
                  </div>
                  <span className={`search-importe ${isIncome ? 'pos' : 'neg'}`}>
                    {isIncome ? '+' : '-'}{fmt(t.importe)}
                  </span>
                </div>
              )
            })}
            {nextCursor && (
              <button className="search-load-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Cargando…' : 'Cargar más'}
              </button>
            )}
          </div>
        )}

        <div className="search-footer">
          <span className="search-footer-label">
            {results.length} mostrado{results.length !== 1 ? 's' : ''}{nextCursor ? '+' : ''}
          </span>
          <span className="search-footer-total">{fmt(shownTotal)}</span>
        </div>
      </div>
    </div>
  )
}
