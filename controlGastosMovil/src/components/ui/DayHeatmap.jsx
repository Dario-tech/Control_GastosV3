import { useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { fmt } from '../../utils'
import DaySummaryModal from './DaySummaryModal'

const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

export default function DayHeatmap({ monthIndex, year }) {
  const { transactions } = useFinanceData()
  const [selectedDay, setSelectedDay] = useState(null)

  // Agrupar transacciones del mes por día, separando ingresos de gastos
  const byDay = {}
  transactions
    .filter(t => t.month === monthIndex)
    .forEach(t => {
      const day = parseInt(t.fecha.split('-')[2], 10)
      if (!isNaN(day)) {
        if (!byDay[day]) byDay[day] = []
        byDay[day].push(t)
      }
    })

  function daySums(day) {
    const ts = byDay[day] || []
    const income  = ts.filter(t => t.bucket === 'income').reduce((s, t) => s + t.importe, 0)
    const expense = ts.filter(t => t.bucket !== 'income').reduce((s, t) => s + t.importe, 0)
    return { income, expense }
  }

  // Máximos del mes (para escalar el color de cada escala por separado)
  const allSums = Object.keys(byDay).map(d => daySums(d))
  const maxIncome  = Math.max(...allSums.map(s => s.income), 1)
  const maxExpense = Math.max(...allSums.map(s => s.expense), 1)

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

  // Primer día de mes → offset lunes=0
  const rawFirst   = new Date(year, monthIndex, 1).getDay()
  const firstOffset = (rawFirst + 6) % 7

  const today         = new Date()
  const isThisMonth   = today.getFullYear() === year && today.getMonth() === monthIndex
  const todayDay      = isThisMonth ? today.getDate() : -1

  // Un día con ingreso se pinta en verde (prioritario, es la señal más
  // notable); si solo tiene gastos, se pinta en rojo como antes.
  function cellColor(day) {
    const { income, expense } = daySums(day)
    if (income > 0) {
      const ratio = Math.min(income / maxIncome, 1)
      const alpha = (0.18 + ratio * 0.72).toFixed(2)
      return `rgba(52,199,89,${alpha})`
    }
    if (expense > 0) {
      const ratio = Math.min(expense / maxExpense, 1)
      const alpha = (0.15 + ratio * 0.72).toFixed(2)
      return `rgba(244,63,94,${alpha})`
    }
    return undefined
  }

  // Celdas: prefijo vacío + días 1..N
  const cells = [
    ...Array(firstOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const hasAnyData = Object.keys(byDay).length > 0

  return (
    <>
      <div className="cal-wrap">
        {/* Leyenda de días de la semana */}
        <div className="cal-dow-row">
          {DOW.map(d => <span key={d} className="cal-dow">{d}</span>)}
        </div>

        {/* Grid */}
        <div className="cal-grid">
          {cells.map((day, i) => {
            if (day === null) return <div key={`e${i}`} className="cal-day cal-empty" />
            const { income, expense } = daySums(day)
            const label = income > 0
              ? `${day} — ingreso ${fmt(income)}`
              : `${day} — ${expense > 0 ? fmt(expense) : 'sin gastos'}`
            return (
              <button
                key={day}
                className={[
                  'cal-day',
                  byDay[day]?.length ? 'has-data' : '',
                  day === todayDay    ? 'today'    : '',
                ].join(' ').trim()}
                style={cellColor(day) ? { background: cellColor(day) } : undefined}
                onClick={() => byDay[day]?.length && setSelectedDay(day)}
                aria-label={label}
              >
                <span className="cal-day-num">{day}</span>
                {byDay[day]?.length ? <span className="cal-day-dot" /> : null}
              </button>
            )
          })}
        </div>

        {/* Leyenda de colores */}
        {hasAnyData && (
          <div className="cal-legend cal-legend-dual">
            <span className="cal-legend-item"><span className="cal-legend-swatch" style={{ background: 'rgba(52,199,89,0.7)' }} /> Ingresos</span>
            <span className="cal-legend-item"><span className="cal-legend-swatch" style={{ background: 'rgba(244,63,94,0.7)' }} /> Gastos</span>
          </div>
        )}
      </div>

      {selectedDay !== null && (
        <DaySummaryModal
          day={selectedDay}
          monthIndex={monthIndex}
          year={year}
          transactions={byDay[selectedDay] ?? []}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </>
  )
}
