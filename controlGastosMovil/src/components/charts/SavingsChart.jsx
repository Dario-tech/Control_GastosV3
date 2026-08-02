import { getActiveMonths, getMonthStats } from '../../utils'
import { MONTH_SHORT } from '../../data/mockData'

function rateColor(r) {
  if (r >= 30) return '#2dd4a0'
  if (r >= 15) return '#ff9f43'
  return '#ff5f7e'
}

export default function SavingsChart({ data }) {
  const now = new Date()
  const months = getActiveMonths(data).map(({ index }) => {
    const stats = getMonthStats(data, index)
    // Mes real en curso sin ingresos registrados todavía: "0%" aquí no significa
    // que ahorraste cero, significa que aún no ha pasado nada que contar — se
    // distingue en vez de mezclarse visualmente con un mes ya cerrado en rojo.
    const incomplete = data.year === now.getFullYear() && index === now.getMonth() && stats.income === 0
    return { index, label: MONTH_SHORT[index], rate: stats.savingsRate, incomplete }
  })

  return (
    <div className="savings-bars">
      {months.map(m => {
        const color = m.incomplete ? 'var(--text3, var(--text2))' : rateColor(m.rate)
        return (
          <div key={m.index} className="saving-row">
            <span className="saving-month">{m.label}</span>
            <div className="saving-bar-bg">
              <div
                className="saving-bar-fill"
                style={{ width: `${m.incomplete ? 2 : Math.max(2, m.rate)}%`, background: color }}
              />
            </div>
            <span className="saving-pct" style={{ color }}>{m.incomplete ? 'en curso' : `${m.rate}%`}</span>
          </div>
        )
      })}
    </div>
  )
}
