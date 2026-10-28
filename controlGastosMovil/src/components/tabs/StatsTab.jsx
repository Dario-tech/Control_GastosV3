import { useMemo, useState } from 'react'
import MonthsChart from '../charts/MonthsChart'
import { fmt, todayLocal } from '../../utils'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useRecurring } from '../../hooks/useRecurring'
import { useApp } from '../../context/AppContext'
import { useAnnualExpenses } from '../../hooks/useAnnualExpenses'
import { useBudget } from '../../hooks/useBudget'
import { useHideAmounts } from '../../hooks/useHideAmounts'
import { fmtAmount } from '../../utils/amounts'
import Amt from '../ui/Amt'
import { MONTH_NAMES, MONTH_SHORT } from '../../data/mockData'
import {
  prepareTransactions, compareSamePeriod, budgetUsage, categoryBreakdown, categoriesAboveUsual,
  fixedVariableSaving, recentMonths, weekdayAverages, biggestExpense, upcomingCharges, monthEndForecast,
  isCurrentMonth, UNUSUAL_FACTOR,
} from '../../utils/stats'

const lc = s => s.toLowerCase()
const DATE_FMT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
const fmtDate = iso => DATE_FMT.format(new Date(iso + 'T12:00:00'))
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`
const pctText = n => `${Math.abs(n)} %`

function StatSection({ id, title, aside, children }) {
  return (
    <section className="card st-card" aria-labelledby={id}>
      <div className="st-head">
        <h2 id={id} className="st-title">{title}</h2>
        {aside}
      </div>
      <div className="st-body">{children}</div>
    </section>
  )
}

// Botón «i» con una explicación corta de cómo se calcula algo.
function Info({ id, label, children }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="st-info-wrap">
      <button type="button" className="st-info-btn" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen(o => !o)}><span className="st-info-dot" aria-hidden="true">i</span></button>
      {open && <span id={id} className="st-info" role="note">{children}</span>}
    </span>
  )
}

// Variación con flecha y número (la flecha y el signo no dependen solo del color).
function Delta({ pct, dir, tone, label }) {
  if (pct == null) return null
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬'
  return (
    <span className={`st-delta st-tone-${tone}`}>
      <span aria-hidden="true">{arrow}</span> {pctText(pct)}
      <span className="sr-only">{dir === 'up' ? ' más' : dir === 'down' ? ' menos' : ' igual'}{label ? ` ${label}` : ''}</span>
    </span>
  )
}

export default function StatsTab() {
  const { data } = useFinanceData()
  const { expenses: annual } = useAnnualExpenses()
  const { items: recurring, status: recurStatus } = useRecurring()
  const { selectedMonth: m, selectedYear } = useApp()
  const { itemsForMonth } = useBudget()
  const hide = useHideAmounts()
  const y = selectedYear || data.year || new Date().getFullYear()

  const todayKey = todayLocal()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [todayKey])

  const prep = useMemo(() => {
    const emojis = {}
    ;[...(data.income || []), ...(data.fixedExpenses || []), ...(data.variableExpenses || [])].forEach(e => { emojis[e.concept] = e.emoji })
    return prepareTransactions(data.transactions, emojis)
  }, [data])

  const view = useMemo(() => {
    const cmp = compareSamePeriod(prep, y, m, now)
    return {
      cmp,
      breakdown: categoryBreakdown(prep, y, m, cmp.cutoff, 6),
      usual: categoriesAboveUsual(prep, y, m, cmp.cutoff),
      split: fixedVariableSaving(prep, y, m, cmp.cutoff),
      months: recentMonths(prep, y, m, 6, now),
      weekday: weekdayAverages(prep, y, m, cmp.cutoff),
      biggest: biggestExpense(prep, y, m, cmp.cutoff),
    }
  }, [prep, y, m, now])
  const { cmp, breakdown, usual, split, months, weekday, biggest } = view

  const budgetItems = itemsForMonth(m)
  const budget = useMemo(
    () => budgetUsage(budgetItems, cmp.byCat, cmp.isCurrent ? cmp.daysLeft + 1 : 0),
    [budgetItems, cmp],
  )
  const forecast = useMemo(
    () => monthEndForecast({ prep, y, m, now, recurring: recurStatus === 'ready' ? recurring : [], annual }),
    [prep, y, m, now, recurring, recurStatus, annual],
  )
  const upcoming = useMemo(
    () => upcomingCharges({ recurring: recurStatus === 'ready' ? recurring : [], annual, bucketOf: prep.bucketOf, now }),
    [recurring, recurStatus, annual, prep, now],
  )

  const monthName = MONTH_NAMES[m]
  const showAvg = cmp.cutoff >= 2 || cmp.variable > 0
  const current = isCurrentMonth(y, m, now)
  const periodTitle = current ? 'Este mes' : `${monthName} ${y}`

  if (!prep.hasData) {
    return (
      <div className="tab-panel">
        <section className="card st-card" aria-labelledby="st-empty">
          <div className="st-head"><h2 id="st-empty" className="st-title">Estadísticas</h2></div>
          <p className="st-empty">Todavía no hay movimientos. Añade ingresos y gastos y aquí verás cómo evoluciona tu mes.</p>
        </section>
      </div>
    )
  }

  const maxCat = Math.max(...breakdown.items.map(c => c.val), 1)
  const maxDay = Math.max(...weekday.items.map(d => d.avg), 1)
  const monthsSummary = months.length
    ? `Ingresos y gastos por mes. ${months.map(r => `${MONTH_NAMES[r.month]}${r.inProgress ? ' (en curso)' : ''}: ingresos ${fmtAmount(r.income, hide)}, gastos ${fmtAmount(r.expenses, hide)}`).join('. ')}.`
    : ''

  return (
    <div className="tab-panel st-panel">

      {/* 1. Este mes */}
      <StatSection id="st-month" title={periodTitle}>
        {cmp.count === 0 ? (
          <p className="st-empty">Sin movimientos en {lc(monthName)}.</p>
        ) : (
          <>
            <p className="st-kpi-label">{current ? `Gastado hasta el día ${cmp.cutoff}` : `Gastado en ${lc(monthName)}`}</p>
            <p className="st-kpi"><Amt>{fmt(cmp.spent)}</Amt></p>
            {cmp.hasPrev ? (
              <p className="st-compare">
                <span>{lc(MONTH_NAMES[cmp.prevMonth])}, días 1–{cmp.prevCutoff}: <Amt>{fmt(cmp.prevSpent)}</Amt></span>
                <span className={`st-delta st-tone-${cmp.tone}`}>
                  <span aria-hidden="true">{cmp.delta > 0 ? '▲' : cmp.delta < 0 ? '▼' : '▬'}</span>{' '}
                  <Amt>{signed(cmp.delta)}</Amt>{cmp.pct != null && <> ({pctText(cmp.pct)})</>}
                  <span className="sr-only">{cmp.delta > 0 ? ', más gasto' : cmp.delta < 0 ? ', menos gasto' : ', igual'}</span>
                </span>
              </p>
            ) : (
              <p className="st-muted">Sin movimientos en {lc(MONTH_NAMES[cmp.prevMonth])} para comparar.</p>
            )}
            {budget ? (
              <div className="st-budget">
                <div className="st-bar" role="progressbar" aria-label="Presupuesto consumido" aria-valuemin={0} aria-valuemax={100} aria-valuenow={budget.pct}
                  aria-valuetext={`${budget.pct} % del presupuesto`}>
                  <div className={`st-bar-fill${budget.over ? ' over' : ''}`} style={{ width: `${budget.pct}%` }} />
                </div>
                <p className="st-row"><span>Presupuestado</span><Amt>{fmt(budget.limit)}</Amt></p>
                <p className="st-row"><span>Gastado en esas categorías</span><Amt>{fmt(budget.spent)}</Amt></p>
                {budget.over
                  ? <p className="st-row st-neg-text"><span>Presupuesto superado en</span><Amt>{fmt(-budget.remaining)}</Amt></p>
                  : current && budget.dailyMargin != null
                    ? <p className="st-row"><span>Margen diario</span><Amt>{fmt(budget.dailyMargin)}</Amt></p>
                    : <p className="st-row"><span>Queda</span><Amt>{fmt(budget.remaining)}</Amt></p>}
              </div>
            ) : (
              <div className="st-budget">
                {showAvg && <p className="st-row"><span>Gasto medio diario</span><Amt>{fmt(cmp.avgDaily)}</Amt></p>}
                {showAvg && cmp.hasPrev && <p className="st-row"><span>{MONTH_SHORT[cmp.prevMonth]}, mismo tramo</span><Amt>{fmt(cmp.prevAvgDaily)}</Amt></p>}
              </div>
            )}
          </>
        )}
      </StatSection>

      {/* 2. Cierre previsto */}
      {current && (
        <StatSection id="st-forecast" title="Cierre previsto"
          aside={forecast && (
            <Info id="st-forecast-info" label="Cómo se calcula el cierre previsto">
              Ingresos previstos: lo cobrado o, si es menos, la media de los meses anteriores. Gastos previstos: lo gastado hasta hoy,
              más los cargos fijos que faltan (recurrentes, gastos anuales y fijos habituales aún sin cargar), más el gasto variable
              al ritmo diario de este mes. Es una estimación.
            </Info>
          )}>
          {!forecast ? (
            <p className="st-empty">La previsión aparece a partir del día 2 y cuando el mes ya tiene movimientos.</p>
          ) : (
            <>
              <p className="st-kpi-label">Resultado estimado a fin de {lc(monthName)}{forecast.lowConfidence ? ' (pocos días de datos)' : ''}</p>
              <p className={`st-kpi ${forecast.result >= 0 ? 'st-pos' : 'st-neg'}`}><Amt>{signed(forecast.result)}</Amt></p>
              <dl className="st-dl">
                <div className="st-row"><dt>Ingresos previstos</dt><dd><Amt>{fmt(forecast.expectedIncome)}</Amt></dd></div>
                <div className="st-row"><dt>Gastado hasta hoy</dt><dd><Amt>{fmt(forecast.spent)}</Amt></dd></div>
                <div className="st-row"><dt>Fijos pendientes</dt><dd><Amt>{fmt(forecast.pendingFixed)}</Amt></dd></div>
                <div className="st-row"><dt>Variables hasta fin de mes</dt><dd><Amt>{fmt(forecast.variableRest)}</Amt></dd></div>
                <div className="st-row st-row-total"><dt>Gastos previstos</dt><dd><Amt>{fmt(forecast.projectedExpenses)}</Amt></dd></div>
              </dl>
              <p className="st-muted">Balance a día {forecast.day}: <Amt>{signed(forecast.balanceNow)}</Amt></p>
            </>
          )}
        </StatSection>
      )}

      {/* 8. Por encima de lo habitual */}
      <StatSection id="st-usual" title="Por encima de lo habitual"
        aside={<Info id="st-usual-info" label="Qué significa por encima de lo habitual">
          Categorías con un gasto de al menos {String(UNUSUAL_FACTOR).replace('.', ',')} veces su media de los 3 meses anteriores, en el mismo tramo del mes.
        </Info>}>
        {!usual.enoughHistory ? (
          <p className="st-empty">Hacen falta al menos 3 meses anteriores con gastos para comparar.</p>
        ) : usual.items.length === 0 ? (
          <p className="st-empty">Ninguna categoría supera su media.</p>
        ) : (
          <ul className="st-usual">
            {usual.items.slice(0, 5).map(c => (
              <li key={c.key}>
                <div className="st-cat-top">
                  <span className="st-cat-name"><span aria-hidden="true">{c.emoji}</span> {c.name}</span>
                  <span className="st-cat-vals"><Amt>{fmt(c.val)}</Amt><span className="st-hint">×{String(c.ratio).replace('.', ',')}</span></span>
                </div>
                <div className="st-bar thin" aria-hidden="true">
                  <div className="st-bar-fill over" style={{ width: '100%' }} />
                  <div className="st-bar-base" style={{ width: `${Math.min(100, (c.avg / c.val) * 100)}%` }} />
                </div>
                <p className="st-hint">Media <Amt>{fmt(c.avg)}</Amt></p>
              </li>
            ))}
          </ul>
        )}
      </StatSection>

      {/* 3. Dónde va el dinero */}
      <StatSection id="st-cats" title="Dónde va el dinero"
        aside={breakdown.baselineMonths > 0 && <span className="st-hint">vs. media de {breakdown.baselineMonths} {breakdown.baselineMonths === 1 ? 'mes' : 'meses'}</span>}>
        {breakdown.items.length === 0 ? (
          <p className="st-empty">Sin gastos en {lc(monthName)}.</p>
        ) : (
          <ul className="st-cats">
            {breakdown.items.map(c => (
              <li key={c.key} className="st-cat">
                <div className="st-cat-top">
                  <span className="st-cat-name"><span aria-hidden="true">{c.emoji}</span> {c.name}</span>
                  <span className="st-cat-vals">
                    <Amt>{fmt(c.val)}</Amt>
                    <span className="st-cat-pct">{c.pct} %</span>
                    {c.change ? <Delta pct={c.change.pct} dir={c.change.dir} tone={c.change.tone} label="que la media" /> : <span className="st-delta-slot" aria-hidden="true" />}
                  </span>
                </div>
                <div className="st-bar thin" aria-hidden="true">
                  <div className="st-bar-fill" style={{ width: `${Math.max(2, Math.round((c.val / maxCat) * 100))}%`, background: c.color }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </StatSection>

      {/* 4. Fijos · variables · ahorro */}
      <StatSection id="st-split" title="Fijos · variables · ahorro">
        {split.empty ? (
          <p className="st-empty">Sin movimientos en {lc(monthName)}.</p>
        ) : (
          <>
            <div className="st-stack" role="img"
              aria-label={`Fijos ${split.pct.fixed} %, variables ${split.pct.variable} %, ahorro ${split.pct.saving} %${split.deficit > 0 ? `; los gastos superan a los ingresos en ${fmtAmount(split.deficit, hide)}` : ''}`}>
              <span className="st-seg fixed" style={{ width: `${split.base > 0 ? (split.fixed / split.base) * 100 : 0}%` }} />
              <span className="st-seg variable" style={{ width: `${split.base > 0 ? (split.variable / split.base) * 100 : 0}%` }} />
              <span className="st-seg saving" style={{ width: `${split.base > 0 ? (split.saving / split.base) * 100 : 0}%` }} />
            </div>
            <ul className="st-legend">
              <li><span className="st-dot fixed" aria-hidden="true" />Fijos <Amt>{fmt(split.fixed)}</Amt> <span className="st-hint">{split.pct.fixed} %</span></li>
              <li><span className="st-dot variable" aria-hidden="true" />Variables <Amt>{fmt(split.variable)}</Amt> <span className="st-hint">{split.pct.variable} %</span></li>
              <li><span className="st-dot saving" aria-hidden="true" />Ahorro <Amt>{fmt(split.saving)}</Amt> <span className="st-hint">{split.pct.saving} %</span></li>
            </ul>
            {split.deficit > 0 && <p className="st-muted">Los gastos superan a los ingresos en <Amt>{fmt(split.deficit)}</Amt>. Porcentajes sobre los gastos.</p>}
          </>
        )}
      </StatSection>

      {/* 5. Últimos 6 meses */}
      <StatSection id="st-months" title="Últimos 6 meses"
        aside={months.length > 0 && <span className="st-legend-inline" aria-hidden="true">
          <span><span className="st-dot inc" />Ingresos</span><span><span className="st-dot exp" />Gastos</span><span><span className="st-dot bal" />Balance</span>
        </span>}>
        {months.length === 0 ? (
          <p className="st-empty">Sin datos en estos meses.</p>
        ) : (
          <>
            <MonthsChart rows={months} ariaLabel={monthsSummary} />
            {months.length === 1 && <p className="st-muted">Solo hay un mes con datos: la comparación aparecerá cuando haya más.</p>}
            <table className="sr-only">
              <caption>Ingresos, gastos y balance por mes</caption>
              <thead><tr><th scope="col">Mes</th><th scope="col">Ingresos</th><th scope="col">Gastos</th><th scope="col">Balance</th></tr></thead>
              <tbody>
                {months.map(r => (
                  <tr key={r.ym}>
                    <th scope="row">{MONTH_NAMES[r.month]} {r.year}{r.inProgress ? ' (en curso)' : ''}</th>
                    <td>{fmtAmount(r.income, hide)}</td><td>{fmtAmount(r.expenses, hide)}</td><td>{fmtAmount(r.balance, hide)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {months.some(r => r.savingsRate != null && !r.inProgress) && (
              <ul className="st-rates" aria-label="Tasa de ahorro por mes">
                {months.map(r => (
                  <li key={r.ym}>
                    <span>{MONTH_SHORT[r.month]}</span>
                    <strong>{r.inProgress ? 'en curso' : r.savingsRate == null ? '–' : `${r.savingsRate} %`}</strong>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </StatSection>

      {/* 6. Cuándo gastas */}
      <StatSection id="st-when" title="Cuándo gastas"
        aside={<Info id="st-when-info" label="Cómo se calcula el gasto por día">
          Gasto variable medio de cada día de la semana en los últimos 3 meses, contando también los días sin gasto. No incluye los gastos fijos.
        </Info>}>
        {weekday.items.length === 0 || weekday.maxIndex < 0 ? (
          <p className="st-empty">Sin gastos variables en el periodo.</p>
        ) : (
          <ul className="st-days">
            {weekday.items.map(d => (
              <li key={d.index} className={d.index === weekday.maxIndex ? 'top' : ''}>
                <span className="st-day-name">{d.name}</span>
                <div className="st-bar thin" aria-hidden="true"><div className="st-bar-fill" style={{ width: `${Math.round((d.avg / maxDay) * 100)}%` }} /></div>
                <Amt>{fmt(d.avg)}</Amt>
              </li>
            ))}
          </ul>
        )}
        {biggest && (
          <p className="st-row st-biggest">
            <span>Movimiento más grande de {lc(monthName)}<br />
              <span className="st-hint">{fmtDate(biggest.fecha)} · <span aria-hidden="true">{biggest.emoji}</span> {biggest.name}</span></span>
            <Amt>{fmt(biggest.importe)}</Amt>
          </p>
        )}
      </StatSection>

      {current && (
      <StatSection id="st-upcoming" title="Próximos cargos" aside={<span className="st-hint">30 días</span>}>
        {recurStatus === 'loading' && upcoming.items.length === 0 ? (
          <p className="st-empty">Cargando…</p>
        ) : upcoming.items.length === 0 ? (
          <p className="st-empty">{recurStatus === 'error'
            ? 'No se han podido cargar los cargos recurrentes.'
            : 'No hay cargos recurrentes ni gastos anuales previstos en los próximos 30 días.'}</p>
        ) : (
          <>
            <ul className="st-upcoming">
              {upcoming.items.map(c => (
                <li key={`${c.kind}-${c.key}-${c.fecha}`}>
                  <time className="st-up-date" dateTime={c.fecha}>{fmtDate(c.fecha)}</time>
                  <span className="st-up-name">{c.name}<span className="st-hint"> · {c.kind}</span></span>
                  <Amt>{fmt(c.importe)}</Amt>
                </li>
              ))}
            </ul>
            <p className="st-row st-row-total"><span>Total 30 días</span><Amt>{fmt(upcoming.total)}</Amt></p>
          </>
        )}
      </StatSection>
      )}

    </div>
  )
}
