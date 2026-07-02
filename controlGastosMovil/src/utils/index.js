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

export function getTopExpenses(data, limit = 6) {
  return [...data.fixedExpenses, ...data.variableExpenses]
    .map(i => ({ name: i.concept, emoji: i.emoji, total: sumConceptAll(i) }))
    .filter(i => i.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}
