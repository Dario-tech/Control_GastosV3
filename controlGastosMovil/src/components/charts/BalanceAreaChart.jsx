import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { getCumulativeBalance, fmt } from '../../utils'
import { MONTH_SHORT } from '../../data/mockData'
import { useChartColors } from '../../hooks/useChartColors'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const v = payload[0].value
  return (
    <div className="chart-tooltip">
      <p className="tt-title">{MONTH_SHORT[label]}</p>
      <p className={`tt-row ${v >= 0 ? 'tt-blue' : 'tt-red'}`}>
        Acumulado <strong>{fmt(v)}</strong>
      </p>
    </div>
  )
}

export default function BalanceAreaChart({ data: financeData }) {
  const { tick, grid, refLine } = useChartColors()
  const data = getCumulativeBalance(financeData).map(d => ({ ...d, monthLabel: MONTH_SHORT[d.month] }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis
          dataKey="monthLabel"
          tick={{ fill: tick, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: tick, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={0} stroke={refLine} strokeDasharray="4 4" />
        <Area
          type="monotone"
          dataKey="cumulative"
          stroke="#a78bfa"
          strokeWidth={2.5}
          fill="url(#balanceGrad)"
          dot={{ fill: '#a78bfa', r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#a78bfa' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
