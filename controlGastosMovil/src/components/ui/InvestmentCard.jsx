import { fmt } from '../../utils'

export default function InvestmentCard({ inv, priceData, valueData, loading, onClick }) {
  const isPositive    = (priceData?.change ?? 0) >= 0
  const returnPositive = (valueData?.returnPct ?? 0) >= 0

  return (
    <div className="inv-card inv-card--clickable" onClick={onClick}>
      <div className="inv-card-top">
        <div className="inv-card-left">
          <div
            className="inv-icon-circle"
            style={{ background: inv.color + '22' }}
          >
            {inv.emoji}
          </div>
          <div>
            <span className="inv-name">{inv.name}</span>
            <div className="inv-meta">
              <span className="inv-ticker">{inv.ticker}</span>
              <span
                className="inv-type-badge"
                style={{ background: inv.color + '18', color: inv.color }}
              >
                {inv.type}
              </span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="inv-price-skeleton" />
        ) : priceData && inv.apiSource !== 'static' ? (
          <div className="inv-price-col">
            <span className="inv-price">
              {inv.apiSource === 'coingecko'
                ? fmt(priceData.price, 0)
                : fmt(priceData.price, 2)}
            </span>
            <span className={`inv-change ${isPositive ? 'pos' : 'neg'}`}>
              {isPositive ? '+' : ''}{priceData.change.toFixed(2)}%
            </span>
            {priceData.source === 'fallback' && (
              <span className="inv-source-badge">~estimado</span>
            )}
          </div>
        ) : inv.apiSource === 'static' && inv.annualYield ? (
          <div className="inv-price-col">
            <span className="inv-price inv-price--sm">{inv.annualYield}% TAE</span>
            <span className="inv-change pos">Renta fija</span>
          </div>
        ) : null}
      </div>

      {inv.description && <p className="inv-desc">{inv.description}</p>}

      {valueData && (
        <div className="inv-return-row">
          <div className="inv-values-row">
            <div className="inv-val-block">
              <span className="inv-val-label">Invertido</span>
              <span className="inv-val-amount">{fmt(inv.invested)}</span>
            </div>
            <div className="inv-val-block" style={{ alignItems: 'flex-end' }}>
              <span className="inv-val-label">Valor actual</span>
              <span className={`inv-val-amount ${returnPositive ? 'pos' : ''}`}>
                {fmt(valueData.currentValue)}
              </span>
            </div>
          </div>
          <div className="inv-bar-bg">
            <div
              className="inv-bar-fill"
              style={{
                width: `${Math.min(100, Math.max(2, 50 + (valueData.returnPct ?? 0) * 2))}%`,
                background: inv.color,
              }}
            />
          </div>
          <div className="inv-return-pct-row">
            <span className={`inv-return-pct ${returnPositive ? 'pos' : 'neg'}`}>
              {returnPositive ? '+' : ''}{(valueData.returnPct ?? 0).toFixed(2)}% total
            </span>
          </div>
        </div>
      )}

      {inv.monthlyPremium && (
        <div className="inv-extra-meta">
          <span>Prima mensual: <strong>{fmt(inv.monthlyPremium)}</strong></span>
          <span>Próximo cobro: <strong>{inv.nextPremium}</strong></span>
        </div>
      )}

      {inv.maturity && (
        <div className="inv-extra-meta">
          <span>Vencimiento: <strong>{inv.maturity}</strong></span>
          <span>TIR anual: <strong>{inv.annualYield}%</strong></span>
        </div>
      )}
    </div>
  )
}
