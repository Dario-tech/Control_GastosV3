import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { getCumulativeBalance } from '../../utils'
import { fmtAmount, axisTick } from '../../utils/amounts'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { MONTH_SHORT } from '../../data/mockData'
import { useChartColors } from '../../hooks/useChartColors'

const CustomTooltip = ({ active, payload, label, hide }) => {
  if (!active || !payload?.length) return null
  const v = payload[0].value
  return (
    <div className="chart-tooltip">
      <p className="tt-title">{MONTH_SHORT[label]}</p>
      <p className={`tt-row ${v >= 0 ? 'tt-blue' : 'tt-red'}`}>
        Acumulado <strong>{fmtAmount(v, hide)}</strong>
      </p>
    </div>
  )
}

export default function BalanceAreaChart({ data: financeData }) {
  const { tick, grid, refLine } = useChartColors()
  const hide = useHideAmounts()
  const data = getCumulativeBalance(financeData).map(d => ({ ...d, monthLabel: MONTH_SHORT[d.month] }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.45} />
            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis
          dataKey="monthLabel"
          tick={{ fill: tick, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: tick, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={axisTick(hide)}
        />
        <Tooltip content={<CustomTooltip hide={hide} />} />
        <ReferenceLine y={0} stroke={refLine} strokeDasharray="4 4" />
        <Area
          type="monotone"
          dataKey="cumulative"
          stroke="#a78bfa"
          strokeWidth={2.5}
          fill="url(#balanceGrad)"
          style={{ filter: 'drop-shadow(0 0 6px #a78bfa)' }}
          dot={{ fill: '#a78bfa', r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#a78bfa' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
