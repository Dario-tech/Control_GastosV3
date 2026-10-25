import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { fmt } from '../../utils'
import { fmtAmount } from '../../utils/amounts'
import { useHideAmounts } from '../../hooks/useHideAmounts'

const COLORS = ['#5b7cff', '#ff9f43']
const LABELS = ['Gastos Fijos', 'Gastos Variables']

const CustomTooltip = ({ active, payload, hide }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="tt-row"><strong>{payload[0].name}</strong></p>
      <p className="tt-row">{fmtAmount(payload[0].value, hide)}</p>
    </div>
  )
}

const RADIAN = Math.PI / 180
const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.05) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>
      {`${Math.round(percent * 100)}%`}
    </text>
  )
}

export default function DonutChart({ fixed, variable }) {
  const hide = useHideAmounts()
  const total = fixed + variable
  const data = [
    { name: 'Gastos Fijos',     value: fixed },
    { name: 'Gastos Variables', value: variable },
  ]

  return (
    <div className="donut-container">
      <div className="donut-chart-wrap">
        <ResponsiveContainer width="100%" height={190}>
          <PieChart>
            <defs>
              {COLORS.map((c, i) => (
                <linearGradient key={i} id={`donutGrad${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%"   stopColor={c} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.55} />
                </linearGradient>
              ))}
            </defs>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={3}
              dataKey="value"
              labelLine={false}
              label={renderCustomLabel}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={`url(#donutGrad${i})`} stroke={COLORS[i]} strokeOpacity={0.5} strokeWidth={1} style={{ filter: `drop-shadow(0 0 6px ${COLORS[i]})` }} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip hide={hide} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <span className="donut-label">Total</span>
          <span className="donut-value">{fmt(total)}</span>
        </div>
      </div>

      <div className="donut-legend">
        {data.map((item, i) => {
          const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
          return (
            <div key={i} className="legend-row">
              <span className="legend-dot" style={{ background: COLORS[i] }} />
              <span className="legend-name">{LABELS[i]}</span>
              <span className="legend-pct">{pct}%</span>
              <span className="legend-amount">{fmt(item.value)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
