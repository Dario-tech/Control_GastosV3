import { lazy, Suspense, useState } from 'react'
import Card from '../ui/Card'
import ConceptList from '../ui/ConceptList'
import DonutChart from '../charts/DonutChart'
import { ChartSkeleton, FormSkeleton } from '../ui/Skeleton'
import { useApp } from '../../context/AppContext'
import { getMonthStats, mergeAnnualSplits, filterDataByYear, getTransactionYears, fmt } from '../../utils'
import { MONTH_NAMES } from '../../data/mockData'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useAnnualExpenses } from '../../hooks/useAnnualExpenses'
import { useSubscriptionMarks } from '../../hooks/useSubscriptionMarks'
import { groupSubscriptionsAsFixed } from '../../utils/subscriptions'
import SubscriptionsCard from '../ui/SubscriptionsCard'
import { useFixedRecurring } from '../../hooks/useFixedRecurring'
import { mergeFixedRecurring } from '../../utils/fixedRecurring'

// Calendario, hoja de mes y detalle de movimientos: solo se bajan al usarlos.
const CalendarView        = lazy(() => import('../ui/CalendarView'))
const MonthYearSheet      = lazy(() => import('../ui/MonthYearSheet'))
const TransactionLogModal = lazy(() => import('../ui/TransactionLogModal'))

const TIPOS = [
  { id: 'todo', label: 'Todo' },
  { id: 'fijo', label: 'Gastos fijos' },
  { id: 'variable', label: 'Gastos variables' },
]
const TIPO_TITULO = {
  todo: 'Distribución de gastos',
  fijo: 'Gastos fijos por concepto',
  variable: 'Gastos variables por concepto',
}

export default function MonthTab() {
  const { selectedMonth, setSelectedMonth, selectedYear, setSelectedYear } = useApp()
  const { data: finance } = useFinanceData()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tipo, setTipo] = useState('todo')
  // El backend agrega por índice de mes (sin año): el año elegido se resuelve
  // aquí filtrando `transactions` (ver filterDataByYear).
  const rawData = filterDataByYear(finance, selectedYear)
  const txYears = getTransactionYears(finance)
  const nowY = new Date().getFullYear()
  const minYear = Math.min(nowY, selectedYear, ...(txYears.length ? txYears : [nowY]))
  const maxYear = Math.max(nowY + 1, selectedYear)
  const { expenses: annualExpenses } = useAnnualExpenses()
  // Los repartos de gastos fijos anuales cuentan como gasto fijo del mes que
  // les toca — se fusionan aquí una vez y de ahí para abajo todo (saldo,
  // donut, listado) los trata igual que cualquier otro gasto fijo.
  // Las categorías marcadas como suscripción cuentan como gasto fijo, en una fila «Suscripciones».
  const { keys: subKeys } = useSubscriptionMarks()
  // Fijos que se repiten cada mes hasta una fecha: se proyectan como previstos.
  const { rules: fixedRules } = useFixedRecurring()
  const data = groupSubscriptionsAsFixed(
    mergeAnnualSplits(mergeFixedRecurring(rawData, fixedRules, selectedYear), annualExpenses), subKeys)
  const [selectedConcept, setSelectedConcept] = useState(null)
  const [heatmapOpen, setHeatmapOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mi-economia-cal-open') ?? 'false') }
    catch { return false }
  })
  // Meses navegables: los que tienen transacciones reales o algún reparto de
  // gasto fijo anual (mergeAnnualSplits ya marca esos meses como activos),
  // más el mes seleccionado por si acaba de dejar de tener reparto.

  function toggleHeatmap() {
    const next = !heatmapOpen
    setHeatmapOpen(next)
    try { localStorage.setItem('mi-economia-cal-open', JSON.stringify(next)) } catch {}
  }
  const stats = getMonthStats(data, selectedMonth)

  // Las flechas avanzan de mes en mes y cruzan de año (dic ↔ ene).
  const canPrev = !(selectedYear <= minYear && selectedMonth === 0)
  const canNext = !(selectedYear >= maxYear && selectedMonth === 11)
  function step(delta) {
    const n = selectedMonth + delta
    setSelectedYear(selectedYear + Math.floor(n / 12))
    setSelectedMonth(((n % 12) + 12) % 12)
  }
  function pickMonth(m, y) { setSelectedMonth(m); setSelectedYear(y) }
  const hasData = (y, m) => !!filterDataByYear(finance, y).activeMonths?.[m]

  const balPos = stats.balance >= 0
  // Mes real en curso y todavía sin ingresos: el saldo en rojo desde el día 2
  // no significa "vas mal", significa "aún no ha pasado nada que contar" —
  // se lo aclaramos en vez de dejar que parezca un cierre de mes real.
  const now = new Date()
  const isIncompleteCurrentMonth =
    selectedYear === now.getFullYear() && selectedMonth === now.getMonth() && stats.income === 0

  function handleSelectConcept(item) {
    if (!item.isAnnualSplit && !item.isSubscriptions && !item.isProjected) setSelectedConcept(item)
  }

  return (
    <div className="tab-panel">

      {/* Hero card */}
      <div className="hero-card">
        <div className="hero-month-nav">
          <button className="hero-month-arrow" onClick={() => step(-1)} disabled={!canPrev} aria-label="Mes anterior">&#8249;</button>
          <button className="hero-month-label hero-month-pick" onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-label={`${MONTH_NAMES[selectedMonth]} ${selectedYear}, elegir mes y año`}>
            {MONTH_NAMES[selectedMonth]} {selectedYear}
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
          </button>
          <button className="hero-month-arrow" onClick={() => step(1)} disabled={!canNext} aria-label="Mes siguiente">&#8250;</button>
        </div>

        <div className="hero-balance">
          <span className="hero-balance-label">Saldo del mes</span>
          <span className={`hero-balance-value ${balPos ? 'pos' : 'neg'}`}>
            {fmt(stats.balance)}
          </span>
          {isIncompleteCurrentMonth && (
            <span className="hero-balance-hint">Mes en curso — todavía sin ingresos registrados</span>
          )}
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
      <div className="s-segmented month-tipo-filter" role="group" aria-label="Filtrar gráficas por tipo de gasto">
        {TIPOS.map(t => (
          <button key={t.id} type="button" className={`s-seg-btn${tipo === t.id ? ' active' : ''}`}
            aria-pressed={tipo === t.id} onClick={() => setTipo(t.id)}>{t.label}</button>
        ))}
      </div>
      <Card title={TIPO_TITULO[tipo]} noPad>
        <DonutChart
          fixed={stats.fixed} variable={stats.variable} tipo={tipo} monthIndex={selectedMonth}
          items={tipo === 'fijo' ? data.fixedExpenses : data.variableExpenses}
        />
      </Card>

      {/* Actividad diaria — plegable */}
      <div className="card">
        <button className="card-collapse-header" onClick={toggleHeatmap}>
          <span className="card-title">📅 Actividad diaria</span>
          <span className={`card-collapse-arrow${heatmapOpen ? ' open' : ''}`}>›</span>
        </button>
        {heatmapOpen && (
          <Suspense fallback={<ChartSkeleton height={280} />}>
            <CalendarView monthIndex={selectedMonth} year={selectedYear} annualExpenses={annualExpenses} tipo={tipo} />
          </Suspense>
        )}
      </div>

      {/* Conceptos */}
      <Card title="💰 Ingresos" noPad>
        <ConceptList items={data.income} monthIndex={selectedMonth} colorClass="income-amt" onSelect={setSelectedConcept} />
      </Card>
      <Card title="🏠 Gastos Fijos" noPad>
        <ConceptList items={data.fixedExpenses} monthIndex={selectedMonth} colorClass="expense-amt" onSelect={handleSelectConcept} />
      </Card>
      <SubscriptionsCard transactions={finance?.transactions} />
      <Card title="💳 Gastos Variables" noPad>
        <ConceptList items={data.variableExpenses} monthIndex={selectedMonth} colorClass="expense-amt" onSelect={setSelectedConcept} />
      </Card>

      {pickerOpen && (
        <Suspense fallback={null}>
          <MonthYearSheet
            year={selectedYear} month={selectedMonth}
            minYear={minYear} maxYear={maxYear}
            hasData={hasData}
            onSelect={pickMonth}
            onClose={() => setPickerOpen(false)}
          />
        </Suspense>
      )}

      {selectedConcept && (
        <Suspense fallback={<FormSkeleton />}>
          <TransactionLogModal
            concept={selectedConcept.concept}
            emoji={selectedConcept.emoji}
            monthIndex={selectedMonth}
            year={selectedYear}
            onClose={() => setSelectedConcept(null)}
          />
        </Suspense>
      )}

    </div>
  )
}
