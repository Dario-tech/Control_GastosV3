import KpiCard from '../ui/KpiCard'
import Card from '../ui/Card'
import IncomeExpenseChart from '../charts/IncomeExpenseChart'
import SavingsGoals from '../ui/SavingsGoals'
import { getYearStats, getActiveMonths, getMonthStats, fmt } from '../../utils'
import { MONTH_NAMES } from '../../data/mockData'
import { useApp } from '../../context/AppContext'
import { useFinanceData } from '../../context/FinanceDataContext'

export default function YearTab() {
  const { goToMonth } = useApp()
  const { data } = useFinanceData()
  const { income, expenses, balance, savingsRate, avgIncome, avgExpenses } = getYearStats(data)
  const activeMonths = getActiveMonths(data)

  return (
    <div className="tab-panel">

      {/* Metas de ahorro: lo primero que se ve al entrar en la app */}
      <SavingsGoals />

      {/* Year hero */}
      <div className="year-hero">
        <div className="year-hero-title">Balance acumulado {data.year}</div>
        <div className="year-hero-balance">{fmt(balance)}</div>
        <div className="year-hero-grid">
          <div className="year-hero-stat">
            <span className="year-hero-stat-label">Ingresos</span>
            <span className="year-hero-stat-value green">{fmt(income)}</span>
          </div>
          <div className="year-hero-stat">
            <span className="year-hero-stat-label">Gastos</span>
            <span className="year-hero-stat-value red">{fmt(expenses)}</span>
          </div>
          <div className="year-hero-stat">
            <span className="year-hero-stat-label">Media ingresos</span>
            <span className="year-hero-stat-value accent">{fmt(avgIncome)}</span>
          </div>
          <div className="year-hero-stat">
            <span className="year-hero-stat-label">Tasa de ahorro</span>
            <span className="year-hero-stat-value">{savingsRate}%</span>
          </div>
        </div>
      </div>

      <Card title="Ingresos vs Gastos" noPad>
        <div style={{ padding: '14px 4px 8px' }}>
          <IncomeExpenseChart data={data} />
        </div>
      </Card>

      <Card title="Resumen mensual" noPad>
        <div className="month-table">
          <div className="mt-row mt-header">
            <div className="mt-cell">Mes</div>
            <div className="mt-cell">Ingresos</div>
            <div className="mt-cell">Gastos</div>
            <div className="mt-cell">Balance</div>
          </div>
          {activeMonths.map(({ index }) => {
            const s = getMonthStats(data, index)
            return (
              <div key={index} className="mt-row" onClick={() => goToMonth(index)}>
                <div className="mt-cell">{MONTH_NAMES[index]}</div>
                <div className="mt-cell positive">{fmt(s.income)}</div>
                <div className="mt-cell negative">{fmt(s.expenses)}</div>
                <div className={`mt-cell ${s.balance >= 0 ? 'positive' : 'negative'}`}>{fmt(s.balance)}</div>
              </div>
            )
          })}
        </div>
      </Card>

    </div>
  )
}
