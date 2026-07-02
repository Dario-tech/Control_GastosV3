import { useState } from 'react'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useHistory } from '../../hooks/useHistory'
import { useChartColors } from '../../hooks/useChartColors'
import { RANGES } from '../../services/historyApi'
import { fmt } from '../../utils'

/* ── Date label formatter ── */
function fmtLabel(ts, days) {
  const d = new Date(ts)
  if (days <= 7)   return d.toLocaleDateString('es-ES', { weekday: 'short' })
  if (days <= 30)  return d.getDate().toString()
  if (days <= 180) return d.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
}

/* ── Custom tooltip for history chart ── */
function HistoryTooltip({ active, payload, inv }) {
  if (!active || !payload?.length) return null
  const price = payload[0].value
  return (
    <div className="chart-tooltip" style={{ minWidth: 120 }}>
      <p className="tt-title" style={{ color: inv.color }}>{inv.ticker}</p>
      <p className="tt-row" style={{ color: 'var(--text)' }}>
        <strong>{inv.apiSource === 'coingecko' ? fmt(price, 0) : fmt(price, 2)}</strong>
      </p>
    </div>
  )
}

/* ── Skeleton rows ── */
function ChartSkeleton() {
  return (
    <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: '90%', height: 120,
        background: 'var(--surface2)',
        borderRadius: 12,
        animation: 'pulse 1.4s ease-in-out infinite',
      }} />
    </div>
  )
}

/* ── Stat tile ── */
function StatTile({ label, value, colored }) {
  return (
    <div className="detail-stat">
      <span className="detail-stat-label">{label}</span>
      <span className="detail-stat-value" style={colored ? { color: colored } : {}}>
        {value}
      </span>
    </div>
  )
}

/* ── Main modal ── */
export default function InvestmentDetailModal({ inv, priceData, valueData, onClose }) {
  useLockBodyScroll()
  const [selectedDays, setSelectedDays] = useState(365)
  const { points, source } = useHistory(inv, priceData?.price, selectedDays)
  const { tick, grid } = useChartColors()

  const loading    = source === 'loading'
  const currentP   = priceData?.price
  const dayChange  = priceData?.change ?? 0
  const changePos  = dayChange >= 0
  const returnPct  = valueData?.returnPct ?? 0
  const returnPos  = returnPct >= 0

  // Chart: pick ticks to show (~5 labels max)
  const tickEvery = Math.max(1, Math.floor((points.length - 1) / 5))
  const ticks     = points.filter((_, i) => i % tickEvery === 0).map(p => p.ts)

  // Reference line at first price
  const basePrice = points[0]?.price

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-sheet" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="detail-header">
          <button className="detail-back-btn" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <div className="detail-header-center">
            <span className="detail-ticker">{inv.ticker}</span>
            <span className="detail-name">{inv.name}</span>
          </div>
          <div
            className="detail-header-badge"
            style={{ background: inv.color + '22', color: inv.color }}
          >
            {inv.type}
          </div>
        </div>

        {/* Price hero */}
        {currentP && inv.apiSource !== 'static' ? (
          <div className="detail-price-hero">
            <span className="detail-price">
              {inv.apiSource === 'coingecko' ? fmt(currentP, 0) : fmt(currentP, 2)}
            </span>
            <span className={`detail-change-pill ${changePos ? 'pos' : 'neg'}`}>
              {changePos ? '▲' : '▼'} {Math.abs(dayChange).toFixed(2)}% hoy
            </span>
          </div>
        ) : inv.apiSource === 'static' && inv.annualYield ? (
          <div className="detail-price-hero">
            <span className="detail-price">{inv.annualYield}% TAE</span>
            <span className="detail-change-pill pos">Renta fija</span>
          </div>
        ) : (
          <div className="detail-price-hero">
            <span className="detail-price">{fmt(valueData?.currentValue ?? inv.invested)}</span>
            <span className={`detail-change-pill ${returnPos ? 'pos' : 'neg'}`}>
              {returnPos ? '+' : ''}{returnPct.toFixed(2)}%
            </span>
          </div>
        )}

        {/* Chart */}
        <div className="detail-chart-wrap">
          {loading ? (
            <ChartSkeleton />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={points}
                margin={{ top: 8, right: 8, left: -24, bottom: 0 }}
              >
                <defs>
                  <linearGradient id={`grad-${inv.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={inv.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={inv.color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  ticks={ticks}
                  tickFormatter={ts => fmtLabel(ts, selectedDays)}
                  tick={{ fill: tick, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: tick, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => inv.apiSource === 'coingecko'
                    ? (v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0))
                    : v.toFixed(0)
                  }
                  width={52}
                />
                <Tooltip
                  content={<HistoryTooltip inv={inv} />}
                  cursor={{ stroke: inv.color, strokeWidth: 1, strokeDasharray: '4 3' }}
                />
                {basePrice && (
                  <ReferenceLine
                    y={basePrice}
                    stroke={grid}
                    strokeDasharray="3 3"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={inv.color}
                  strokeWidth={2.5}
                  fill={`url(#grad-${inv.id})`}
                  dot={false}
                  activeDot={{ r: 5, fill: inv.color, strokeWidth: 0 }}
                  isAnimationActive={points.length < 200}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Range selector */}
        <div className="detail-ranges">
          {RANGES.map(r => (
            <button
              key={r.days}
              className={`detail-range-btn${selectedDays === r.days ? ' active' : ''}`}
              style={selectedDays === r.days ? { background: inv.color + '22', color: inv.color } : {}}
              onClick={() => setSelectedDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Source badge */}
        {source === 'synthetic' && (
          <div className="detail-synthetic-note">
            ⚠️ Datos simulados — API no disponible en este momento
          </div>
        )}

        {/* Position stats */}
        {valueData && (
          <div className="detail-stats-section">
            <div className="detail-stats-title">Resumen de posición</div>
            <div className="detail-stats-grid">
              <StatTile label="Invertido"     value={fmt(inv.invested)} />
              <StatTile
                label="Valor actual"
                value={loading ? '···' : fmt(valueData.currentValue)}
                colored={returnPos ? 'var(--green)' : 'var(--red)'}
              />
              <StatTile
                label="Rentabilidad"
                value={`${returnPos ? '+' : ''}${returnPct.toFixed(2)}%`}
                colored={returnPos ? 'var(--green)' : 'var(--red)'}
              />
              {inv.units && (
                <StatTile label="Unidades" value={inv.units % 1 === 0 ? inv.units : inv.units.toFixed(inv.units < 1 ? 4 : 2)} />
              )}
              {inv.avgBuyPrice && inv.apiSource !== 'static' && (
                <StatTile
                  label="Precio medio"
                  value={inv.apiSource === 'coingecko'
                    ? fmt(inv.avgBuyPrice, 0)
                    : fmt(inv.avgBuyPrice, 2)
                  }
                />
              )}
              {inv.annualYield && (
                <StatTile label="TAE" value={`${inv.annualYield}%`} colored="var(--green)" />
              )}
              {inv.monthlyPremium && (
                <StatTile label="Prima/mes" value={fmt(inv.monthlyPremium)} />
              )}
              {inv.maturity && (
                <StatTile label="Vencimiento" value={inv.maturity} />
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
