import { useState, useEffect, useRef, useCallback } from 'react'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { searchTransactions } from '../../services/api'
import { fmt } from '../../utils'
import { MONTH_SHORT_LC } from '../../data/mockData'
import { useFocusTrap, Icon } from './FormKit'
import Amt from './Amt'

const FILTERS = [
  { id: 'all',              label: 'Todos'     },
  { id: 'income',           label: 'Ingresos'  },
  { id: 'fixedExpenses',    label: 'Fijos'     },
  { id: 'variableExpenses', label: 'Variables' },
]

// Mensaje legible para el usuario según el tipo de fallo.
export function searchErrorMessage(e, fallback = 'No se pudo buscar') {
  if (e?.status === 401) return e.message
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return 'El servidor tarda en responder (puede estar despertando). Inténtalo de nuevo en unos segundos.'
  }
  if (e instanceof TypeError) return 'Sin conexión con el servidor. Revisa tu conexión e inténtalo de nuevo.'
  return e?.message || fallback
}

export default function TransactionSearchModal({ onClose }) {
  useLockBodyScroll()
  const [query, setQuery]     = useState('')
  const [filter, setFilter]   = useState('all')
  const [results, setResults] = useState([])
  const [nextCursor, setNextCursor]   = useState(null)
  const [unreadable, setUnreadable]   = useState(0)
  const [loading, setLoading]         = useState(true)
  const [slow, setSlow]               = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState(null)
  const [moreError, setMoreError]     = useState(null)
  const requestId = useRef(0)
  const sheetRef  = useRef(null)
  const inputRef  = useRef(null)
  const closeRef  = useRef(onClose)
  closeRef.current = onClose
  useFocusTrap(sheetRef)

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Si la primera respuesta tarda, se avisa de que el servidor puede estar despertando.
  useEffect(() => {
    if (!loading) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(t)
  }, [loading])

  // Busca en el backend desde cero (nueva query o filtro) — paginado, no trae
  // todo el histórico de golpe.
  const runSearch = useCallback(async (q, tipo) => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    setMoreError(null)
    try {
      const { results: page = [], next_cursor = null, unreadable: bad = 0 } =
        await searchTransactions({ q: q.trim(), tipo, limit: 30 })
      if (id !== requestId.current) return // respuesta obsoleta (query cambió mientras esperábamos)
      setResults(page)
      setNextCursor(next_cursor)
      setUnreadable(bad)
    } catch (e) {
      if (id !== requestId.current) return
      setResults([])
      setNextCursor(null)
      setError(searchErrorMessage(e))
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
    const id = requestId.current
    setLoadingMore(true)
    setMoreError(null)
    try {
      const { results: page = [], next_cursor = null, unreadable: bad = 0 } =
        await searchTransactions({ q: query.trim(), tipo: filter, cursor: nextCursor, limit: 30 })
      if (id !== requestId.current) return // cambió la búsqueda mientras tanto
      setResults(prev => [...prev, ...page])
      setNextCursor(next_cursor)
      setUnreadable(n => n + bad)
    } catch (e) {
      if (id === requestId.current) setMoreError(searchErrorMessage(e, 'No se pudo cargar más'))
    } finally {
      setLoadingMore(false)
    }
  }

  // Neto de lo mostrado: ingresos suman, gastos restan.
  const shownNet = results.reduce((s, t) => s + (t.bucket === 'income' ? t.importe : -t.importe), 0)
  const hasResults = results.length > 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-sheet search-sheet"
        role="dialog" aria-modal="true" aria-label="Buscar movimientos"
        ref={sheetRef} tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-drag-handle" />

        <div className="search-header">
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por concepto…"
            aria-label="Buscar por concepto"
          />
          <button type="button" className="search-close" onClick={onClose} aria-label="Cerrar búsqueda">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="search-filters" role="group" aria-label="Filtrar por tipo">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              className={`search-filter-chip${filter === f.id ? ' active' : ''}`}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >{f.label}</button>
          ))}
        </div>

        <div className="search-status" role="status" aria-live="polite">
          {!error && loading && (
            <div className="search-empty">
              Buscando…
              {slow && <small className="search-slow">El servidor puede estar despertando; puede tardar hasta un minuto.</small>}
            </div>
          )}
          {!loading && !error && !hasResults && (
            <div className="search-empty">
              {nextCursor
                ? 'Sin coincidencias en los movimientos revisados todavía.'
                : (query.trim() ? `Sin resultados para «${query.trim()}»` : 'Aún no hay movimientos')}
            </div>
          )}
        </div>

        {error && (
          <div className="search-empty search-error" role="alert">
            {error}
            <button type="button" className="search-retry" onClick={() => runSearch(query, filter)}>Reintentar</button>
          </div>
        )}

        {!error && !loading && (hasResults || nextCursor) && (
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
            {moreError && <div className="search-empty search-error" role="alert">{moreError}</div>}
            {nextCursor && (
              <button type="button" className="search-load-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Cargando…' : (moreError ? 'Reintentar' : 'Cargar más')}
              </button>
            )}
          </div>
        )}

        {unreadable > 0 && !error && (
          <p className="search-note">
            {unreadable} movimiento{unreadable !== 1 ? 's' : ''} no se ha{unreadable !== 1 ? 'n' : ''} podido leer y no aparece{unreadable !== 1 ? 'n' : ''}.
          </p>
        )}

        <div className="search-footer">
          <span className="search-footer-label">
            {results.length} mostrado{results.length !== 1 ? 's' : ''}{nextCursor ? '+' : ''}
          </span>
          <span className="search-footer-total" title="Ingresos menos gastos de lo mostrado">
            <Amt>{shownNet < 0 ? '-' : ''}{fmt(Math.abs(shownNet))}</Amt>
          </span>
        </div>
      </div>
    </div>
  )
}
