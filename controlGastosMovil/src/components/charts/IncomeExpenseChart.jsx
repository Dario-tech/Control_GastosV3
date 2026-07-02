import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { getChartData, fmt } from '../../utils'
import { MONTH_SHORT } from '../../data/mockData'
import { useChartColors } from '../../hooks/useChartColors'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const inc = payload.find(p => p.dataKey === 'income')?.value ?? 0
  const exp = payload.find(p => p.dataKey === 'expenses')?.value ?? 0
  const bal = inc - exp
  return (
    <div className="chart-tooltip">
      <p className="tt-title">{MONTH_SHORT[label]}</p>
      <p className="tt-row tt-green">Ingresos <strong>{fmt(inc)}</strong></p>
      <p className="tt-row tt-red">Gastos <strong>{fmt(exp)}</strong></p>
      <p className={`tt-row ${bal >= 0 ? 'tt-blue' : 'tt-red'}`}>Balance <strong>{fmt(bal)}</strong></p>
    </div>
  )
}

export default function IncomeExpenseChart({ data: financeData }) {
  const { tick, grid, cursor } = useChartColors()
  const data = getChartData(financeData).map(d => ({ ...d, monthLabel: MONTH_SHORT[d.month] }))

  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barGap={3}>
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
        <Tooltip content={<CustomTooltip />} cursor={{ fill: cursor }} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: tick, paddingTop: 8 }}
          formatter={(value) => value === 'income' ? 'Ingresos' : 'Gastos'}
        />
        <Bar dataKey="income"   name="income"   fill="#22c55e" radius={[4,4,0,0]} maxBarSize={28} />
        <Bar dataKey="expenses" name="expenses" fill="#f43f5e" radius={[4,4,0,0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}
