import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { fmtAmount, axisTick } from '../../utils/amounts'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { useChartColors } from '../../hooks/useChartColors'
import { niceTicks } from '../../utils/stats'
import { MONTH_SHORT } from '../../data/mockData'

// Etiqueta del eje X en dos líneas: mes y, si es el mes real en curso, «en curso».
function MonthTick({ x, y, index, rows, color }) {
  const row = rows[index]
  if (!row) return null
  return (
    <text x={x} y={y + 12} textAnchor="middle" fill={color} fontSize={12}>
      <tspan x={x}>{MONTH_SHORT[row.month]}</tspan>
      {row.inProgress && <tspan x={x} dy={13} fontSize={10}>en curso</tspan>}
    </text>
  )
}

function Tip({ active, payload, hide }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="chart-tooltip">
      <p className="tt-title">{MONTH_SHORT[r.month]} {r.year}{r.inProgress ? ' · en curso' : ''}</p>
      <p className="tt-row tt-green">Ingresos <strong>{fmtAmount(r.income, hide)}</strong></p>
      <p className="tt-row tt-red">Gastos <strong>{fmtAmount(r.expenses, hide)}</strong></p>
      <p className={`tt-row ${r.balance >= 0 ? 'tt-blue' : 'tt-red'}`}>Balance <strong>{fmtAmount(r.balance, hide)}</strong></p>
    </div>
  )
}

/** Ingresos y gastos por mes (barras) con el balance (línea). `rows` viene de recentMonths(). */
export default function MonthsChart({ rows, ariaLabel }) {
  const { grid, refLine, cursor, incomeColor, expenseColor } = useChartColors()
  const hide = useHideAmounts()
  const values = rows.flatMap(r => [r.income, r.expenses, r.balance])
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const tickColor = 'var(--chart-tick, currentColor)'
  const multi = rows.length > 1

  return (
    <div role="img" aria-label={ariaLabel} className="st-chart">
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={rows} margin={{ top: 6, right: 6, left: -10, bottom: 14 }} barGap={2} aria-hidden="true">
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="ym" interval={0} tickLine={false} axisLine={false} height={34}
            tick={props => <MonthTick {...props} rows={rows} color={tickColor} />} />
          <YAxis ticks={ticks} domain={[ticks[0], ticks[ticks.length - 1]]} tickLine={false} axisLine={false}
            width={44} tick={{ fill: tickColor, fontSize: 11 }} tickFormatter={axisTick(hide)} />
          <ReferenceLine y={0} stroke={refLine} />
          <Tooltip content={<Tip hide={hide} />} cursor={{ fill: cursor }} />
          <Bar dataKey="income" name="Ingresos" fill={incomeColor} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {rows.map(r => <Cell key={r.ym} fillOpacity={r.inProgress ? 0.55 : 1} />)}
          </Bar>
          <Bar dataKey="expenses" name="Gastos" fill={expenseColor} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {rows.map(r => <Cell key={r.ym} fillOpacity={r.inProgress ? 0.55 : 1} />)}
          </Bar>
          {multi && (
            <Line dataKey="balance" name="Balance" type="monotone" stroke="var(--accent-fg, var(--accent))" strokeWidth={2}
              dot={{ r: 3 }} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
