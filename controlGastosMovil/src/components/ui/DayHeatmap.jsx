import { useState } from 'react'
import { useFinanceData } from '../../context/FinanceDataContext'
import { fmt } from '../../utils'
import DaySummaryModal from './DaySummaryModal'

const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

export default function DayHeatmap({ monthIndex, year }) {
  const { transactions } = useFinanceData()
  const [selectedDay, setSelectedDay] = useState(null)

  // Agrupar transacciones del mes por día
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

  // Máximo gasto diario (para escalar el color)
  const maxSpent = Math.max(
    ...Object.values(byDay).map(ts => ts.reduce((s, t) => s + t.importe, 0)),
    1,
  )

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

  // Primer día de mes → offset lunes=0
  const rawFirst   = new Date(year, monthIndex, 1).getDay()
  const firstOffset = (rawFirst + 6) % 7

  const today         = new Date()
  const isThisMonth   = today.getFullYear() === year && today.getMonth() === monthIndex
  const todayDay      = isThisMonth ? today.getDate() : -1

  function cellColor(day) {
    const ts = byDay[day]
    if (!ts?.length) return undefined
    const total = ts.reduce((s, t) => s + t.importe, 0)
    const ratio = Math.min(total / maxSpent, 1)
    const alpha = (0.15 + ratio * 0.72).toFixed(2)
    return `rgba(244,63,94,${alpha})`
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
          {cells.map((day, i) =>
            day === null ? (
              <div key={`e${i}`} className="cal-day cal-empty" />
            ) : (
              <button
                key={day}
                className={[
                  'cal-day',
                  byDay[day]?.length ? 'has-data' : '',
                  day === todayDay    ? 'today'    : '',
                ].join(' ').trim()}
                style={cellColor(day) ? { background: cellColor(day) } : undefined}
                onClick={() => byDay[day]?.length && setSelectedDay(day)}
                aria-label={`${day} — ${byDay[day] ? fmt(byDay[day].reduce((s, t) => s + t.importe, 0)) : 'sin gastos'}`}
              >
                <span className="cal-day-num">{day}</span>
                {byDay[day]?.length ? <span className="cal-day-dot" /> : null}
              </button>
            )
          )}
        </div>

        {/* Escala de color */}
        {hasAnyData && (
          <div className="cal-legend">
            <span className="cal-legend-label">Menos gasto</span>
            <div className="cal-legend-scale">
              {[0.15, 0.3, 0.45, 0.62, 0.87].map(a => (
                <div key={a} className="cal-legend-dot" style={{ background: `rgba(244,63,94,${a})` }} />
              ))}
            </div>
            <span className="cal-legend-label">Más gasto</span>
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
