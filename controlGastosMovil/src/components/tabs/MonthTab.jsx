import { useState } from 'react'
import Card from '../ui/Card'
import ConceptList from '../ui/ConceptList'
import DonutChart from '../charts/DonutChart'
import TransactionLogModal from '../ui/TransactionLogModal'
import DayHeatmap from '../ui/DayHeatmap'
import { useApp } from '../../context/AppContext'
import { getMonthStats, getActiveMonths, getMonthlyReport, getBalanceForecast, fmt } from '../../utils'
import { MONTH_NAMES } from '../../data/mockData'
import { useFinanceData } from '../../context/FinanceDataContext'

export default function MonthTab() {
  const { selectedMonth, setSelectedMonth } = useApp()
  const { data } = useFinanceData()
  const [selectedConcept, setSelectedConcept] = useState(null)
  const [heatmapOpen, setHeatmapOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mi-economia-cal-open') ?? 'false') }
    catch { return false }
  })
  const active = getActiveMonths(data)

  function toggleHeatmap() {
    const next = !heatmapOpen
    setHeatmapOpen(next)
    try { localStorage.setItem('mi-economia-cal-open', JSON.stringify(next)) } catch {}
  }
  const currentIdx = active.findIndex(m => m.index === selectedMonth)
  const stats = getMonthStats(data, selectedMonth)
  const report = getMonthlyReport(data, selectedMonth)
  const forecast = getBalanceForecast(data, selectedMonth)

  function prev() {
    if (currentIdx > 0) setSelectedMonth(active[currentIdx - 1].index)
  }
  function next() {
    if (currentIdx < active.length - 1) setSelectedMonth(active[currentIdx + 1].index)
  }

  const balPos = stats.balance >= 0

  return (
    <div className="tab-panel">

      {/* Hero card */}
      <div className="hero-card">
        <div className="hero-month-nav">
          <button className="hero-month-arrow" onClick={prev} disabled={currentIdx <= 0}>&#8249;</button>
          <span className="hero-month-label">{MONTH_NAMES[selectedMonth]}</span>
          <button className="hero-month-arrow" onClick={next} disabled={currentIdx >= active.length - 1}>&#8250;</button>
        </div>

        <div className="hero-balance">
          <span className="hero-balance-label">Saldo del mes</span>
          <span className={`hero-balance-value ${balPos ? 'pos' : 'neg'}`}>
            {fmt(stats.balance)}
          </span>
        </div>

        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-label">Ingresos</span>
            <span className="hero-stat-value green">{fmt(stats.income)}</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">G. Fijos</span>
            <span className="hero-stat-value accent">{fmt(stats.fixed)}</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">G. Variables</span>
            <span className="hero-stat-value red">{fmt(stats.variable)}</span>
          </div>
        </div>
      </div>

      {/* Previsión de saldo a fin de mes */}
      {forecast && (
        <Card title="Previsión a fin de mes" noPad>
          <div className="forecast-body">
            <div className="forecast-main">
              <span className="forecast-label">
                Saldo estimado el {forecast.daysInMonth}
                {forecast.confidence === 'low' && <span className="forecast-conf"> · estimación temprana</span>}
              </span>
              <span className={`forecast-value ${forecast.projectedBalance >= 0 ? 'pos' : 'neg'}`}>
                {fmt(forecast.projectedBalance)}
              </span>
              <span className="forecast-sub">
                Ahora mismo: {fmt(forecast.currentBalance)} · día {forecast.daysElapsed} de {forecast.daysInMonth}
              </span>
            </div>
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
        </Card>
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

      {/* Distribución */}
      <Card title="Distribución de gastos" noPad>
        <DonutChart fixed={stats.fixed} variable={stats.variable} />
      </Card>

      {/* Actividad diaria — plegable */}
      <div className="card">
        <button className="card-collapse-header" onClick={toggleHeatmap}>
          <span className="card-title">📅 Actividad diaria</span>
          <span className={`card-collapse-arrow${heatmapOpen ? ' open' : ''}`}>›</span>
        </button>
        {heatmapOpen && (
          <DayHeatmap monthIndex={selectedMonth} year={data.year || new Date().getFullYear()} />
        )}
      </div>

      {/* Conceptos */}
      <Card title="💰 Ingresos" noPad>
        <ConceptList items={data.income} monthIndex={selectedMonth} colorClass="income-amt" onSelect={setSelectedConcept} />
      </Card>
      <Card title="🏠 Gastos Fijos" noPad>
        <ConceptList items={data.fixedExpenses} monthIndex={selectedMonth} colorClass="expense-amt" onSelect={setSelectedConcept} />
      </Card>
      <Card title="💳 Gastos Variables" noPad>
        <ConceptList items={data.variableExpenses} monthIndex={selectedMonth} colorClass="expense-amt" onSelect={setSelectedConcept} />
      </Card>

      {selectedConcept && (
        <TransactionLogModal
          concept={selectedConcept.concept}
          emoji={selectedConcept.emoji}
          monthIndex={selectedMonth}
          onClose={() => setSelectedConcept(null)}
        />
      )}

    </div>
  )
}
