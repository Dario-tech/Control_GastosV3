import { useState } from 'react'
import { Sheet, Icon } from './FormKit'
import { MONTH_NAMES as FULL, MONTH_SHORT as SHORT } from '../../data/mockData'


/* Hoja de cristal para elegir mes (y año). Se reutiliza en Mes y Planificación.
   `hasData(year, month)` marca los meses con datos; los futuros sin datos se
   atenúan pero siguen siendo elegibles. `hideYear` oculta el selector de año. */
export default function MonthYearSheet({ year, month, onSelect, onClose, hasData, minYear, maxYear, hideYear = false, title = 'Elegir mes' }) {
  const now = new Date()
  const curY = now.getFullYear()
  const curM = now.getMonth()
  const lo = minYear ?? Math.min(year, curY)
  const hi = maxYear ?? Math.max(year, curY) + 1
  const [view, setView] = useState(year)

  const pick = (y, m) => { onSelect(m, y); onClose() }

  return (
    <Sheet title={title} onClose={onClose}>
      {!hideYear && (
        <div className="fm-yearbar">
          <button type="button" className="fm-icon-btn" onClick={() => setView(v => v - 1)} disabled={view <= lo} aria-label="Año anterior">
            <Icon name="back" />
          </button>
          <span className="fm-yearbar-label tabular" aria-live="polite">{view}</span>
          <button type="button" className="fm-icon-btn fm-icon-btn--next" onClick={() => setView(v => v + 1)} disabled={view >= hi} aria-label="Año siguiente">
            <Icon name="back" />
          </button>
        </div>
      )}
      <div className="fm-mgrid" role="radiogroup" aria-label="Mes">
        {SHORT.map((name, i) => {
          const sel = view === year && i === month
          const data = !!hasData?.(view, i)
          const future = view > curY || (view === curY && i > curM)
          const isNow = view === curY && i === curM
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={sel}
              aria-label={`${FULL[i]} ${view}${data ? ', con movimientos' : ''}`}
              className={`fm-mcell${sel ? ' selected' : ''}${future && !data ? ' dim' : ''}${isNow ? ' now' : ''}`}
              onClick={() => pick(view, i)}
            >
              <span>{name}</span>
              {data && <span className="fm-mcell-dot" aria-hidden="true" />}
              {sel && <span className="fm-tile-check"><Icon name="check" size={12} /></span>}
            </button>
          )
        })}
      </div>
      <div className="fm-sheet-actions">
        <button type="button" className="fm-secondary" onClick={() => pick(curY, curM)}>Hoy · {SHORT[curM]} {curY}</button>
        <button type="button" className="fm-secondary" onClick={onClose}>Cerrar</button>
      </div>
    </Sheet>
  )
}
