import { useState } from 'react'
import { INVESTMENTS } from '../../data/investmentData'
import { useInvestments } from '../../hooks/useInvestments'
import InvestmentCard from '../ui/InvestmentCard'
import InvestmentDetailModal from '../ui/InvestmentDetailModal'
import { fmt } from '../../utils'

function Section({ title, items, prices, getValue, loading, onSelect }) {
  return (
    <div className="inv-section">
      <div className="inv-section-title">{title}</div>
      {items.map(inv => (
        <InvestmentCard
          key={inv.id}
          inv={inv}
          priceData={prices[inv.id]}
          valueData={getValue(inv)}
          loading={loading}
          onClick={() => onSelect(inv)}
        />
      ))}
    </div>
  )
}

function SourceLegend({ prices }) {
  const all = [
    ...INVESTMENTS.longTerm,
    ...INVESTMENTS.shortTerm,
    ...INVESTMENTS.pias,
  ]
  const hasLive     = all.some(i => prices[i.id]?.source === 'live')
  const hasFallback = all.some(i => prices[i.id]?.source === 'fallback')

  if (!hasLive && !hasFallback) return null
  return (
    <div className="inv-legend">
      {hasLive     && <><span className="inv-legend-dot live" /><span className="inv-legend-text">Tiempo real</span></>}
      {hasFallback && <><span className="inv-legend-dot fallback" /><span className="inv-legend-text">~Estimado</span></>}
    </div>
  )
}

export default function InvestmentsTab() {
  const [selected, setSelected] = useState(null)
  const { prices, status, lastUpdated, refresh, getValue, getTotals } = useInvestments()
  const loading = status === 'loading'
  const { totalInvested, totalCurrent, totalReturn } = getTotals()
  const returnPos = totalReturn >= 0

  function fmtTime(date) {
    if (!date) return ''
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="tab-panel">

      {/* Portfolio hero */}
      <div className="inv-hero">
        <div className="inv-hero-top">
          <div>
            <div className="inv-hero-label">Valor de cartera</div>
            <div className="inv-hero-value">
              {loading ? '···' : fmt(totalCurrent)}
            </div>
            <div className={`inv-hero-return ${returnPos ? 'pos' : 'neg'}`}>
              {loading ? '' : `${returnPos ? '+' : ''}${totalReturn.toFixed(1)}% rentabilidad total`}
            </div>
          </div>
          <button
            className={`inv-refresh-btn ${loading ? 'spinning' : ''}`}
            onClick={refresh}
            disabled={loading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>

        <div className="inv-hero-stats">
          <div className="inv-hero-stat">
            <span className="inv-hero-stat-label">Total invertido</span>
            <span className="inv-hero-stat-value">{fmt(totalInvested)}</span>
          </div>
          <div className="inv-hero-stat">
            <span className="inv-hero-stat-label">Plusvalía</span>
            <span className={`inv-hero-stat-value ${returnPos ? 'pos' : ''}`}>
              {loading ? '···' : `${returnPos ? '+' : ''}${fmt(totalCurrent - totalInvested)}`}
            </span>
          </div>
        </div>

        <div className="inv-hero-last-updated">
          {lastUpdated ? `Actualizado a las ${fmtTime(lastUpdated)}` : 'Actualizando...'}
        </div>
      </div>

      <SourceLegend prices={prices} />

      <Section
        title="📈 Largo Plazo"
        items={INVESTMENTS.longTerm}
        prices={prices}
        getValue={getValue}
        loading={loading}
        onSelect={setSelected}
      />
      <Section
        title="⏱️ Corto Plazo"
        items={INVESTMENTS.shortTerm}
        prices={prices}
        getValue={getValue}
        loading={loading}
        onSelect={setSelected}
      />
      <Section
        title="🛡️ PIAS"
        items={INVESTMENTS.pias}
        prices={prices}
        getValue={getValue}
        loading={loading}
        onSelect={setSelected}
      />

      {selected && (
        <InvestmentDetailModal
          inv={selected}
          priceData={prices[selected.id]}
          valueData={getValue(selected)}
          onClose={() => setSelected(null)}
        />
      )}

    </div>
  )
}
