import { fmt } from '../../../utils'
import { BUDGET_STATUS, budgetProgress } from '../../../utils/budget'
import Amt from '../Amt'

/* ── Ítem de categoría ── */
export default function BudgetItem({ item, spent, threshold, onEdit }) {
  const { rawPct, pct, remaining, over, st } = budgetProgress(spent, item.limit, threshold)
  const color = item.color || 'var(--accent)'

  return (
    <div className={`bgt-item bgt-st-${st}`} onClick={onEdit}>
      <div className="bgt-item-top">
        <div className="bgt-item-left">
          <span className="bgt-item-emoji">{item.emoji}</span>
          <div className="bgt-item-titles">
            <span className="bgt-item-name">{item.name}</span>
            <span className="bgt-item-sub tabular"><Amt>{fmt(spent)} / {fmt(item.limit)}</Amt></span>
          </div>
        </div>
        <span className="bgt-item-pct tabular">{Math.round(rawPct)}%</span>
      </div>

      <div className="bgt-bar-bg" role="progressbar" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={Math.round(rawPct)} aria-label={`Gastado en ${item.name}`}>
        <div
          className="bgt-bar-fill"
          style={{
            width: `${pct}%`,
            '--bar-color': over ? 'var(--red)' : color,
          }}
        />
      </div>

      <div className="bgt-bar-footer">
        <span className="bgt-status-chip"><span aria-hidden="true">{BUDGET_STATUS[st].icon}</span>{BUDGET_STATUS[st].label}</span>
        <span className="bgt-rem-label tabular">
          {over ? <>Excedido <Amt>{fmt(-remaining)}</Amt></> : <>Quedan <Amt>{fmt(remaining)}</Amt></>}
        </span>
      </div>
    </div>
  )
}
