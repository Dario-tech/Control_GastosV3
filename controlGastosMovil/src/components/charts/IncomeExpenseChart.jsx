import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { getChartData } from '../../utils'
import { fmtAmount, axisTick } from '../../utils/amounts'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { MONTH_SHORT } from '../../data/mockData'
import { useChartColors } from '../../hooks/useChartColors'

const CustomTooltip = ({ active, payload, label, hide }) => {
  if (!active || !payload?.length) return null
  const inc = payload.find(p => p.dataKey === 'income')?.value ?? 0
  const exp = payload.find(p => p.dataKey === 'expenses')?.value ?? 0
  const bal = inc - exp
  return (
    <div className="chart-tooltip">
      <p className="tt-title">{MONTH_SHORT[label]}</p>
      <p className="tt-row tt-green">Ingresos <strong>{fmtAmount(inc, hide)}</strong></p>
      <p className="tt-row tt-red">Gastos <strong>{fmtAmount(exp, hide)}</strong></p>
      <p className={`tt-row ${bal >= 0 ? 'tt-blue' : 'tt-red'}`}>Balance <strong>{fmtAmount(bal, hide)}</strong></p>
    </div>
  )
}

export default function IncomeExpenseChart({ data: financeData }) {
  const { tick, grid, cursor, incomeColor, expenseColor } = useChartColors()
  const hide = useHideAmounts()
  const data = getChartData(financeData).map(d => ({ ...d, monthLabel: MONTH_SHORT[d.month] }))

  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barGap={3}>
        <defs>
          <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={incomeColor} stopOpacity={0.95} />
            <stop offset="100%" stopColor={incomeColor} stopOpacity={0.35} />
          </linearGradient>
          <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={expenseColor} stopOpacity={0.95} />
            <stop offset="100%" stopColor={expenseColor} stopOpacity={0.35} />
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
        <Tooltip content={<CustomTooltip hide={hide} />} cursor={{ fill: cursor }} />
        <Legend
          wrapperStyle={{ fontSize: 12, color: tick, paddingTop: 8 }}
          formatter={(value) => value === 'income' ? 'Ingresos' : 'Gastos'}
        />
        <Bar dataKey="income"   name="income"   fill="url(#incomeGrad)" stroke={incomeColor} strokeOpacity={0.5} radius={[4,4,0,0]} maxBarSize={28} style={{ filter: `drop-shadow(0 0 5px ${incomeColor})` }} />
        <Bar dataKey="expenses" name="expenses" fill="url(#expenseGrad)" stroke={expenseColor} strokeOpacity={0.5} radius={[4,4,0,0]} maxBarSize={28} style={{ filter: `drop-shadow(0 0 5px ${expenseColor})` }} />
      </BarChart>
    </ResponsiveContainer>
  )
}
