import { getActiveMonths, getMonthStats } from '../../utils'
import { MONTH_SHORT } from '../../data/mockData'

function rateColor(r) {
  if (r >= 30) return '#2dd4a0'
  if (r >= 15) return '#ff9f43'
  return '#ff5f7e'
}

export default function SavingsChart({ data }) {
  const months = getActiveMonths(data).map(({ index }) => ({
    index,
    label: MONTH_SHORT[index],
    rate: getMonthStats(data, index).savingsRate,
  }))

  return (
    <div className="savings-bars">
      {months.map(m => {
        const color = rateColor(m.rate)
        return (
          <div key={m.index} className="saving-row">
            <span className="saving-month">{m.label}</span>
            <div className="saving-bar-bg">
              <div
                className="saving-bar-fill"
                style={{ width: `${Math.max(2, m.rate)}%`, background: color }}
              />
            </div>
            <span className="saving-pct" style={{ color }}>{m.rate}%</span>
          </div>
        )
      })}
    </div>
  )
}
