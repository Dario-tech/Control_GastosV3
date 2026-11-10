import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import Amt from '../ui/Amt'
import { fmt } from '../../utils'
import { fmtAmount } from '../../utils/amounts'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { groupConceptsForMonth } from '../../utils/conceptBreakdown'

// Los colores salen del tema que ha elegido el usuario (--chart-N en App.css),
// no van fijos: en pastel el gráfico es pastel, en oscuro/ocean/etc. usa los
// tonos de ese tema. «Todo» usa los dos primeros; por concepto, en orden.
const COLORS = ['var(--chart-1)', 'var(--chart-2)']
const CONCEPT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-other)']
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
  if (percent < 0.05 || percent > 0.99) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>
      {`${Math.round(percent * 100)}%`}
    </text>
  )
}

export default function DonutChart({ fixed, variable, tipo = 'todo', items, monthIndex }) {
  const hide = useHideAmounts()
  const byConcept = tipo !== 'todo'
  const rows = byConcept ? groupConceptsForMonth(items, monthIndex) : null
  const total = byConcept ? rows.reduce((s, r) => s + r.value, 0) : fixed + variable
  const colors = byConcept ? CONCEPT_COLORS : COLORS
  const data = byConcept
    ? rows.map(r => ({ name: r.name, value: r.value }))
    : [
      { name: 'Gastos Fijos',     value: fixed },
      { name: 'Gastos Variables', value: variable },
    ]
  if (byConcept && rows.length === 0) {
    return <p className="donut-empty">{tipo === 'fijo' ? 'Sin gastos fijos este mes.' : 'Sin gastos variables este mes.'}</p>
  }
  if (!byConcept && !(total > 0)) {
    return <p className="donut-empty">Sin gastos este mes.</p>
  }
  // Tramos a 0 no se dibujan: con paddingAngle dejan una rendija en el anillo
  const slices = data.map((d, i) => ({ ...d, i })).filter(d => d.value > 0)

  return (
    <div className="donut-container">
      <div className="donut-chart-wrap">
        <ResponsiveContainer width="100%" height={190}>
          <PieChart>
            <defs>
              {colors.map((c, i) => (
                <linearGradient key={i} id={`donutGrad${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%"   style={{ stopColor: c }} stopOpacity={0.95} />
                  <stop offset="100%" style={{ stopColor: c }} stopOpacity={0.55} />
                </linearGradient>
              ))}
            </defs>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={slices.length > 1 ? 3 : 0}
              dataKey="value"
              labelLine={false}
              label={renderCustomLabel}
            >
              {slices.map(({ i }) => (
                <Cell key={i} fill={`url(#donutGrad${i})`} strokeOpacity={0.5} strokeWidth={1} style={{ stroke: colors[i], filter: `drop-shadow(0 0 6px color-mix(in srgb, ${colors[i]} 60%, transparent))` }} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip hide={hide} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <span className="donut-label">Total</span>
          <span className="donut-value"><Amt>{fmt(total)}</Amt></span>
        </div>
      </div>

      <div className="donut-legend">
        {data.map((item, i) => {
          const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
          return (
            <div key={i} className="legend-row">
              <span className="legend-dot" style={{ background: colors[i] }} />
              <span className="legend-name">{byConcept ? `${rows[i].emoji ? rows[i].emoji + ' ' : ''}${item.name}` : LABELS[i]}</span>
              <span className="legend-pct">{pct}%</span>
              <span className="legend-amount"><Amt>{fmt(item.value)}</Amt></span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
