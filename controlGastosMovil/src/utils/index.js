/** "YYYY-MM-DD" con la fecha LOCAL del dispositivo (no UTC: tras medianoche toISOString da otro día). */
export function localISODate(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Fecha local de hoy en "YYYY-MM-DD". */
export function todayLocal(now = new Date()) {
  return localISODate(now)
}

/** Fecha local desplazada `days` días (negativo = atrás), por calendario: seguro con cambios de hora. */
export function addDaysLocal(days, from = new Date()) {
  return localISODate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days))
}

export function fmt(n, decimals = 0) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)
}

export function sumMonth(arr, m) {
  return arr.reduce((t, i) => t + (i.amounts[m] || 0), 0)
}

export function sumAll(arr) {
  return arr.reduce((t, i) => t + i.amounts.reduce((s, v) => s + v, 0), 0)
}

export function sumConceptAll(item) {
  return item.amounts.reduce((s, v) => s + v, 0)
}

// Mete los repartos de gastos fijos anuales (IBI, seguro del coche…) dentro
// de fixedExpenses como una categoría más, con sus importes en los meses del
// reparto — así cuentan igual que un gasto fijo normal en TODOS los cálculos
// derivados (saldo del mes, balance del año, previsión, top gastos…) sin
// tener que tocar cada uno por separado.
export function mergeAnnualSplits(data, annualExpenses) {
  if (!annualExpenses?.length) return data
  const synthetic = annualExpenses
    .filter(e => e.meses_reparto?.length)
    .map(e => {
      const amounts = Array(12).fill(0)
      e.meses_reparto.forEach(m => { amounts[m - 1] = e.reparto_mensual })
      return { concept: `${e.nombre} · reparto`, emoji: '📅', amounts, isAnnualSplit: true }
    })
  if (!synthetic.length) return data
  // También cuentan como mes "activo" — si no, el mes con solo un reparto (sin
  // transacciones reales todavía) desaparecería de tablas/gráficos que iteran
  // activeMonths, aunque su importe sí sume en los totales.
  const activeMonths = [...data.activeMonths]
  synthetic.forEach(s => s.amounts.forEach((v, i) => { if (v) activeMonths[i] = true }))
  return { ...data, activeMonths, fixedExpenses: [...data.fixedExpenses, ...synthetic] }
}

export function getActiveMonths(data) {
  return data.activeMonths
    .map((active, i) => ({ active, index: i }))
    .filter(m => m.active)
}

export function getMonthStats(data, m) {
  const income   = sumMonth(data.income, m)
  const fixed    = sumMonth(data.fixedExpenses, m)
  const variable = sumMonth(data.variableExpenses, m)
  const expenses = fixed + variable
  const balance  = income - expenses
  const savingsRate = income > 0 ? Math.round((balance / income) * 100) : 0
  return { income, fixed, variable, expenses, balance, savingsRate }
}

export function getYearStats(data) {
  const active = getActiveMonths(data)
  const n = active.length || 1
  const income   = sumAll(data.income)
  const fixed    = sumAll(data.fixedExpenses)
  const variable = sumAll(data.variableExpenses)
  const expenses = fixed + variable
  const balance  = income - expenses
  const savingsRate = income > 0 ? Math.round((balance / income) * 100) : 0
  return { income, fixed, variable, expenses, balance, savingsRate, avgIncome: Math.round(income/n), avgExpenses: Math.round(expenses/n) }
}

export function getChartData(data) {
  return getActiveMonths(data).map(({ index }) => {
    const s = getMonthStats(data, index)
    return { month: index, ...s }
  })
}

export function getCumulativeBalance(data) {
  let acc = 0
  return getActiveMonths(data).map(({ index }) => {
    const { balance } = getMonthStats(data, index)
    acc += balance
    return { month: index, cumulative: acc }
  })
}

export function getMonthlyReport(data, m) {
  const activeIdxs = getActiveMonths(data).map(x => x.index)
  const pos = activeIdxs.indexOf(m)
  if (pos <= 0) return null  // sin mes anterior con datos, no hay comparación

  const prevMonth = activeIdxs[pos - 1]
  const cur  = getMonthStats(data, m)
  const prev = getMonthStats(data, prevMonth)

  const expDelta = cur.expenses - prev.expenses
  const expPct   = prev.expenses > 0 ? Math.round((expDelta / prev.expenses) * 100) : null
  const savingsDelta = cur.balance - prev.balance

  // Categorías que más se movieron respecto al mes anterior
  const movers = [...data.fixedExpenses, ...data.variableExpenses]
    .map(i => ({
      name:  i.concept,
      emoji: i.emoji,
      delta: (i.amounts[m] || 0) - (i.amounts[prevMonth] || 0),
    }))
    .filter(c => Math.abs(c.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 2)

  return { prevMonth, month: m, cur, prev, expDelta, expPct, savingsDelta, movers }
}

export function getBalanceForecast(data, m, now = new Date()) {
  const year = data.year || now.getFullYear()
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === m
  if (!isCurrentMonth) return null

  const daysInMonth  = new Date(now.getFullYear(), m + 1, 0).getDate()
  const daysElapsed  = now.getDate()
  if (daysElapsed < 2) return null  // sin datos suficientes el día 1

  const stats = getMonthStats(data, m)

  // Gasto variable: extrapola el ritmo diario observado al mes completo
  const dailyVariableRate  = stats.variable / daysElapsed
  const projectedVariable  = dailyVariableRate * daysInMonth

  // Fijos e ingresos: usa la media de hasta 3 meses anteriores con datos,
  // y nunca proyecta menos de lo que ya consta este mes (algo ya ha pasado).
  const activeIdxs  = getActiveMonths(data).map(x => x.index)
  const pos          = activeIdxs.indexOf(m)
  const prevMonths   = activeIdxs.slice(Math.max(0, pos - 3), pos < 0 ? activeIdxs.length : pos)

  const avgFixed  = prevMonths.length
    ? prevMonths.reduce((s, mi) => s + sumMonth(data.fixedExpenses, mi), 0) / prevMonths.length
    : stats.fixed
  const avgIncome = prevMonths.length
    ? prevMonths.reduce((s, mi) => s + sumMonth(data.income, mi), 0) / prevMonths.length
    : stats.income

  const projectedFixed   = Math.max(stats.fixed, avgFixed)
  const projectedIncome  = stats.income > 0 ? stats.income : avgIncome
  const projectedExpenses = projectedFixed + projectedVariable
  const projectedBalance  = projectedIncome - projectedExpenses

  return {
    daysElapsed, daysInMonth,
    currentBalance:   stats.balance,
    projectedIncome, projectedFixed, projectedVariable, projectedExpenses,
    projectedBalance,
    confidence: daysElapsed >= 10 ? 'high' : daysElapsed >= 5 ? 'medium' : 'low',
  }
}

export function isUnusualAmount(data, concepto, importe, factor = 2) {
  const txs = (data.transactions || []).filter(t => t.concepto === concepto)
  if (txs.length < 3) return null  // sin historial suficiente para comparar
  const avg = txs.reduce((s, t) => s + t.importe, 0) / txs.length
  if (avg <= 0 || importe < avg * factor) return null
  return { avg, ratio: Math.round((importe / avg) * 10) / 10 }
}

export function getTopExpenses(data, limit = 6) {
  return [...data.fixedExpenses, ...data.variableExpenses]
    .map(i => ({ name: i.concept, emoji: i.emoji, total: sumConceptAll(i) }))
    .filter(i => i.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

// Años presentes en las transacciones (el backend agrega por índice de mes sin
// distinguir año, así que el año se resuelve aquí a partir de `transactions`).
export function getTransactionYears(data) {
  const ys = new Set()
  ;(data?.transactions || []).forEach(t => {
    const y = parseInt(String(t.fecha || '').slice(0, 4), 10)
    if (!isNaN(y)) ys.add(y)
  })
  return [...ys].sort((a, b) => a - b)
}

// Devuelve los datos de un año concreto reconstruidos desde `transactions`.
// Si todas las transacciones son de un único año (caso actual) y es el pedido,
// devuelve `data` tal cual — sin ningún cambio de comportamiento.
export function filterDataByYear(data, year) {
  const years = getTransactionYears(data)
  if (years.length === 0) return { ...data, year }
  if (years.length === 1 && years[0] === year) return data
  const emojis = {}
  ;['income', 'fixedExpenses', 'variableExpenses'].forEach(k =>
    (data[k] || []).forEach(e => { emojis[e.concept] = e.emoji }))
  const txs = data.transactions.filter(t => parseInt(String(t.fecha).slice(0, 4), 10) === year)
  const out = { ...data, year, activeMonths: Array(12).fill(false), income: [], fixedExpenses: [], variableExpenses: [], transactions: txs }
  const byConcept = {}
  txs.forEach(t => {
    const m = t.month
    if (m == null || m < 0 || m > 11) return
    const key = `${t.bucket}|${t.concepto}`
    if (!byConcept[key]) {
      byConcept[key] = { bucket: t.bucket, entry: { concept: t.concepto, emoji: emojis[t.concepto] || '💶', amounts: Array(12).fill(0) } }
    }
    byConcept[key].entry.amounts[m] += t.importe
    out.activeMonths[m] = true
  })
  Object.values(byConcept).forEach(({ bucket, entry }) => { if (out[bucket]) out[bucket].push(entry) })
  ;['income', 'fixedExpenses', 'variableExpenses'].forEach(k =>
    out[k].sort((a, b) => b.amounts.reduce((s, v) => s + v, 0) - a.amounts.reduce((s, v) => s + v, 0)))
  return out
}
