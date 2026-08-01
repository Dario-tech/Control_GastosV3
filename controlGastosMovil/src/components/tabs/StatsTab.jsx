import Card from '../ui/Card'
import SavingsChart from '../charts/SavingsChart'
import BalanceAreaChart from '../charts/BalanceAreaChart'
import { getTopExpenses, getYearStats, sumAll, fmt } from '../../utils'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useRecurring } from '../../hooks/useRecurring'

const BREAKDOWN_COLORS = ['#5b7cff','#2dd4a0','#ff9f43','#ff5f7e','#ffd93d','#6bcfff','#a78bff']

const RECUR_DATE_FMT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
function fmtRecurDate(dateStr) {
  try { return RECUR_DATE_FMT.format(new Date(dateStr + 'T12:00:00')) } catch { return dateStr }
}

export default function StatsTab() {
  const { data } = useFinanceData()
  const { items: recurring, status: recurStatus } = useRecurring()
  const top = getTopExpenses(data, 6)
  const maxTop = top[0]?.total || 1
  const { income, expenses } = getYearStats(data)

  const breakdown = [
    { name: '🏠 Alquiler',      val: sumAll(data.fixedExpenses.filter(i => i.concept === 'Alquiler')) },
    { name: '📈 Inversiones',   val: sumAll(data.fixedExpenses.filter(i => i.concept === 'Inversiones' || i.concept === 'Cripto')) },
    { name: '🎉 Ocio',          val: sumAll(data.variableExpenses.filter(i => i.concept === 'Ocio & salidas')) },
    { name: '✈️  Viajes',       val: sumAll(data.variableExpenses.filter(i => i.concept === 'Vuelos / Viajes')) },
    { name: '🍽️  Comida',       val: sumAll(data.variableExpenses.filter(i => i.concept === 'Comida')) },
    { name: '⚡ Suministros',   val: sumAll(data.fixedExpenses.filter(i => ['Luz','Gas','WiFi'].includes(i.concept))) },
    { name: '🚇 Transporte',    val: sumAll(data.fixedExpenses.filter(i => i.concept === 'Transporte')) },
  ].filter(c => c.val > 0).sort((a, b) => b.val - a.val)

  const maxBreak = breakdown[0]?.val || 1

  return (
    <div className="tab-panel">

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
        <div className="breakdown-list">
          {breakdown.map((c, i) => {
            const pct = expenses > 0 ? Math.round((c.val / expenses) * 100) : 0
            return (
              <div key={i} className="breakdown-item">
                <div className="breakdown-row">
                  <span className="breakdown-name">{c.name}</span>
                  <span className="breakdown-amount">{fmt(c.val)}</span>
                </div>
                <div className="breakdown-bar-bg">
                  <div
                    className="breakdown-bar-fill"
                    style={{
                      width: `${Math.round((c.val / maxBreak) * 100)}%`,
                      background: BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length],
                    }}
                  />
                </div>
                <span className="breakdown-pct">{pct}% del total</span>
              </div>
            )
          })}
        </div>
      </Card>

    </div>
  )
}
