import { useState } from 'react'
import Card from '../ui/Card'
import ConceptList from '../ui/ConceptList'
import DonutChart from '../charts/DonutChart'
import TransactionLogModal from '../ui/TransactionLogModal'
import DayHeatmap from '../ui/DayHeatmap'
import { useApp } from '../../context/AppContext'
import { getMonthStats, getActiveMonths, fmt } from '../../utils'
import { MONTH_NAMES } from '../../data/mockData'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useAnnualExpenses } from '../../hooks/useAnnualExpenses'

export default function MonthTab() {
  const { selectedMonth, setSelectedMonth } = useApp()
  const { data } = useFinanceData()
  const { expenses: annualExpenses } = useAnnualExpenses()
  const [selectedConcept, setSelectedConcept] = useState(null)
  const [heatmapOpen, setHeatmapOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mi-economia-cal-open') ?? 'false') }
    catch { return false }
  })
  // Meses navegables: los que tienen transacciones reales + los que tienen
  // algún reparto de gasto fijo anual (para poder revisar el mes por adelantado
  // aunque todavía no haya ninguna transacción registrada en él).
  const activeIndexSet = new Set(getActiveMonths(data).map(m => m.index))
  annualExpenses.forEach(e => e.meses_reparto?.forEach(m => activeIndexSet.add(m - 1)))
  activeIndexSet.add(selectedMonth)
  const active = [...activeIndexSet].sort((a, b) => a - b).map(index => ({ active: true, index }))

  function toggleHeatmap() {
    const next = !heatmapOpen
    setHeatmapOpen(next)
    try { localStorage.setItem('mi-economia-cal-open', JSON.stringify(next)) } catch {}
  }
  const currentIdx = active.findIndex(m => m.index === selectedMonth)
  const stats = getMonthStats(data, selectedMonth)

  function prev() {
    if (currentIdx > 0) setSelectedMonth(active[currentIdx - 1].index)
  }
  function next() {
    if (currentIdx < active.length - 1) setSelectedMonth(active[currentIdx + 1].index)
  }

  const balPos = stats.balance >= 0

  // Gastos fijos anuales repartidos que caen en el mes seleccionado (estimación,
  // no una transacción real todavía) — se muestran junto a los gastos fijos.
  const annualSplitsThisMonth = annualExpenses
    .filter(e => e.meses_reparto?.includes(selectedMonth + 1))
    .map(e => {
      const amounts = Array(12).fill(0)
      amounts[selectedMonth] = e.reparto_mensual
      return { concept: `${e.nombre} · reparto`, emoji: '📅', amounts, isAnnualSplit: true }
    })
  const fixedWithAnnual = [...data.fixedExpenses, ...annualSplitsThisMonth]

  function handleSelectConcept(item) {
    if (!item.isAnnualSplit) setSelectedConcept(item)
  }

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
        <ConceptList items={fixedWithAnnual} monthIndex={selectedMonth} colorClass="expense-amt" onSelect={handleSelectConcept} />
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
