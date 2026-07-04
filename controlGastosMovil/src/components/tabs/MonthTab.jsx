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

export default function MonthTab() {
  const { selectedMonth, setSelectedMonth } = useApp()
  const { data } = useFinanceData()
  const [selectedConcept, setSelectedConcept] = useState(null)
  const active = getActiveMonths(data)
  const currentIdx = active.findIndex(m => m.index === selectedMonth)
  const stats = getMonthStats(data, selectedMonth)

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

      {/* Distribución */}
      <Card title="Distribución de gastos" noPad>
        <DonutChart fixed={stats.fixed} variable={stats.variable} />
      </Card>

      {/* Actividad diaria */}
      <Card title="Actividad diaria" noPad>
        <DayHeatmap monthIndex={selectedMonth} year={data.year || new Date().getFullYear()} />
      </Card>

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
