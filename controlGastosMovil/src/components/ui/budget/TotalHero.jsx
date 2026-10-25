import { fmt } from '../../../utils'
import { BUDGET_STATUS, budgetProgress } from '../../../utils/budget'
import Amt from '../Amt'

/* ── Hero total mensual ── */
export default function TotalHero({ totalLimit, totalSpent, daysLeft, threshold }) {
  const { rawPct, pct, remaining, over, st } = budgetProgress(totalSpent, totalLimit, threshold)
  const pace = !over && daysLeft > 0 ? remaining / daysLeft : null

  return (
    <div className={`bgt-hero bgt-st-${st}`}>
      <div className="bgt-hero-top">
        <div className="bgt-hero-left">
          <span className="bgt-hero-title">Total mensual</span>
          <span className="bgt-hero-sub tabular"><Amt>{fmt(totalSpent)} de {fmt(totalLimit)}</Amt></span>
        </div>
        {daysLeft > 0 && <span className="bgt-days-badge">{daysLeft}d restantes</span>}
      </div>

      <div className="bgt-hero-main">
        <span className="bgt-hero-remaining tabular"><Amt>{fmt(Math.abs(remaining))}</Amt></span>
        <span className="bgt-hero-remaining-label">{over ? 'excedido' : 'restantes'}</span>
      </div>

      <div className="bgt-bar-bg bgt-bar-bg--lg" role="progressbar" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={Math.round(rawPct)} aria-label="Gastado del presupuesto total">
        <div className="bgt-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="bgt-bar-footer">
        <span className="bgt-pct-label">Gastado {Math.round(rawPct)}%</span>
        <span className="bgt-status-chip"><span aria-hidden="true">{BUDGET_STATUS[st].icon}</span>{BUDGET_STATUS[st].label}</span>
      </div>
      {pace != null && (
        <div className="bgt-pace tabular">Ritmo sugerido: <Amt>{fmt(pace)}</Amt> al día</div>
      )}
    </div>
  )
}
