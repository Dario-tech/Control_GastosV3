import Card from '../ui/Card'
import SavingsChart from '../charts/SavingsChart'
import BalanceAreaChart from '../charts/BalanceAreaChart'
import { getTopExpenses, getYearStats, sumAll, fmt, getBalanceForecast, getMonthlyReport, mergeAnnualSplits } from '../../utils'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useRecurring } from '../../hooks/useRecurring'
import { useApp } from '../../context/AppContext'
import { useAnnualExpenses } from '../../hooks/useAnnualExpenses'
import { getExpenseBreakdown } from '../../utils/breakdown'
import Amt from '../ui/Amt'
import { MONTH_NAMES } from '../../data/mockData'

const RECUR_DATE_FMT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
function fmtRecurDate(dateStr) {
  try { return RECUR_DATE_FMT.format(new Date(dateStr + 'T12:00:00')) } catch { return dateStr }
}

export default function StatsTab() {
  const { data: rawData } = useFinanceData()
  const { expenses: annualExpenses } = useAnnualExpenses()
  const data = mergeAnnualSplits(rawData, annualExpenses)
  const { selectedMonth } = useApp()
  const { items: recurring, status: recurStatus } = useRecurring()
  const top = getTopExpenses(data, 6)
  const maxTop = top[0]?.total || 1
  const { income, expenses } = getYearStats(data)
  const forecast = getBalanceForecast(data, selectedMonth)
  const report = getMonthlyReport(data, selectedMonth)

  const { items: breakdown, total: breakdownTotal } = getExpenseBreakdown(data, 6)

  const maxBreak = Math.max(...breakdown.map(c => c.val), 1)

  return (
    <div className="tab-panel">

      {/* Previsión de saldo a fin de mes */}
      {forecast && (
        <div className="stats-forecast-card">
          <span className="stats-forecast-label">
            Previsión a fin de {MONTH_NAMES[selectedMonth]}
            {forecast.confidence === 'low' && <span className="forecast-conf"> · estimación temprana</span>}
          </span>
          <span className={`stats-forecast-value ${forecast.projectedBalance >= 0 ? 'pos' : 'neg'}`}>
            {fmt(forecast.projectedBalance)}
          </span>
          <span className="stats-forecast-sub">
            Ahora mismo: <Amt>{fmt(forecast.currentBalance)}</Amt> · día {forecast.daysElapsed} de {forecast.daysInMonth}
          </span>
          <div className="forecast-stats">
            <div className="forecast-stat">
              <span className="forecast-stat-label">Ingresos est.</span>
              <span className="forecast-stat-value green">{fmt(forecast.projectedIncome)}</span>
            </div>
            <div className="forecast-stat">
              <span className="forecast-stat-label">Fijos est.</span>
              <span className="forecast-stat-value accent">{fmt(forecast.projectedFixed)}</span>
            </div>
            <div className="forecast-stat">
              <span className="forecast-stat-label">Variables est.</span>
              <span className="forecast-stat-value red">{fmt(forecast.projectedVariable)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Informe de cierre vs mes anterior */}
      {report && (report.expPct !== null || report.movers.length > 0) && (
        <Card title="Resumen del mes" noPad>
          <div className="report-body">
            <p className="report-headline">
              {report.expPct !== null && (
                <>Gastaste un <strong className={report.expDelta > 0 ? 'neg' : 'pos'}>
                  {Math.abs(report.expPct)}% {report.expDelta > 0 ? 'más' : 'menos'}
                </strong> que en {MONTH_NAMES[report.prevMonth]}
                {report.movers.length > 0 ? ', ' : '.'}</>
              )}
              {report.movers.length > 0 && (
                <>{report.expPct !== null ? 'sobre todo en ' : 'Este mes destaca '}
                  {report.movers.map((mv, i) => (
                    <span key={mv.name}>
                      {i > 0 ? ' y ' : ''}<strong>{mv.emoji} {mv.name}</strong>
                    </span>
                  ))}.</>
              )}
            </p>
            <div className="report-stats">
              <div className="report-stat">
                <span className="report-stat-label">Gasto vs {MONTH_NAMES[report.prevMonth].slice(0, 3)}.</span>
                <span className={`report-stat-value ${report.expDelta > 0 ? 'neg' : 'pos'}`}>
                  {report.expDelta > 0 ? '+' : ''}{fmt(report.expDelta)}
                </span>
              </div>
              <div className="report-stat">
                <span className="report-stat-label">Ahorro vs {MONTH_NAMES[report.prevMonth].slice(0, 3)}.</span>
                <span className={`report-stat-value ${report.savingsDelta >= 0 ? 'pos' : 'neg'}`}>
                  {report.savingsDelta >= 0 ? '+' : ''}{fmt(report.savingsDelta)}
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Resumen financiero compacto */}
      <div className="stats-summary">
        <div className="stats-summary-item">
          <span className="ss-label">Ingresos anuales</span>
          <span className="ss-value positive">{fmt(income)}</span>
        </div>
        <div className="stats-summary-item">
          <span className="ss-label">Gastos anuales</span>
          <span className="ss-value negative">{fmt(expenses)}</span>
        </div>
        <div className="stats-summary-item">
          <span className="ss-label">Meses analizados</span>
          <span className="ss-value">{data.activeMonths.filter(Boolean).length}</span>
        </div>
      </div>

      <Card title="Tasa de ahorro por mes" noPad>
        <div style={{ padding: '10px 14px 14px' }}>
          <SavingsChart data={data} />
        </div>
      </Card>

      <Card title="Balance acumulado" noPad>
        <div style={{ padding: '14px 4px 8px' }}>
          <BalanceAreaChart data={data} />
        </div>
      </Card>

      {recurStatus === 'ready' && recurring.length > 0 && (
        <Card title="Suscripciones detectadas" noPad>
          <div className="recur-list">
            {recurring.map((r, i) => (
              <div key={i} className="recur-item">
                <div className="recur-info">
                  <span className="recur-name">{r.concepto}</span>
                  <span className="recur-meta">
                    {r.frecuencia} · próximo ≈ {fmtRecurDate(r.proxima)}
                  </span>
                </div>
                <span className="recur-amount">{fmt(r.importe)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Top categorías de gasto" noPad>
        <div className="top-list">
          {top.map((item, i) => (
            <div key={i} className="top-item">
              <span className="top-rank">#{i + 1}</span>
              <div className="top-info">
                <span className="top-name">{item.emoji} {item.name}</span>
                <div className="top-bar-bg">
                  <div
                    className="top-bar-fill"
                    style={{ width: `${Math.round((item.total / maxTop) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="top-amount">{fmt(item.total)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="¿En qué va el dinero?" noPad>
        {breakdown.length === 0 ? (
          <p className="breakdown-empty">Aún no hay gastos registrados. Cuando añadas movimientos verás aquí en qué categorías se va tu dinero.</p>
        ) : (
          <div className="breakdown-list">
            {breakdown.map(c => (
              <div key={c.key} className="breakdown-item">
                <div className="breakdown-row">
                  <span className="breakdown-name">{c.emoji} {c.name}</span>
                  <span className="breakdown-amount">{fmt(c.val)}</span>
                </div>
                <div className="breakdown-bar-bg">
                  <div
                    className="breakdown-bar-fill"
                    style={{ width: `${Math.round((c.val / maxBreak) * 100)}%`, background: c.color }}
                  />
                </div>
                <span className="breakdown-pct">{c.pct}% del total</span>
              </div>
            ))}
            <div className="breakdown-total">
              <span>Total gastos</span>
              <span className="breakdown-amount">{fmt(breakdownTotal)}</span>
            </div>
          </div>
        )}
      </Card>

    </div>
  )
}
