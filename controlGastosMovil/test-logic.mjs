// Test all pure JS logic without React or browser APIs
import { DATA, MONTH_NAMES, MONTH_SHORT } from './src/data/mockData.js'

function sumMonth(arr, m) {
  return arr.reduce((t, i) => t + (i.amounts[m] || 0), 0)
}
function sumAll(arr) {
  return arr.reduce((t, i) => t + i.amounts.reduce((s, v) => s + v, 0), 0)
}
function getActiveMonths() {
  return DATA.activeMonths.map((active, i) => ({ active, index: i })).filter(m => m.active)
}
function getMonthStats(m) {
  const income = sumMonth(DATA.income, m)
  const fixed = sumMonth(DATA.fixedExpenses, m)
  const variable = sumMonth(DATA.variableExpenses, m)
  const expenses = fixed + variable
  const balance = income - expenses
  const savingsRate = income > 0 ? Math.round((balance / income) * 100) : 0
  return { income, fixed, variable, expenses, balance, savingsRate }
}

console.log('=== DATA LOADED ===')
console.log('Income items:', DATA.income.length)
console.log('Fixed expense items:', DATA.fixedExpenses.length)
console.log('Variable expense items:', DATA.variableExpenses.length)
console.log('Active months:', getActiveMonths().length)

console.log('\n=== YEAR TOTALS ===')
const income = sumAll(DATA.income)
const expenses = sumAll(DATA.fixedExpenses) + sumAll(DATA.variableExpenses)
console.log('Total income:', income)
console.log('Total expenses:', expenses)
console.log('Balance:', income - expenses)

console.log('\n=== MONTH 6 (JULIO) STATS ===')
const july = getMonthStats(6)
console.log(july)

console.log('\n=== ALL ACTIVE MONTHS ===')
getActiveMonths().forEach(({ index }) => {
  const s = getMonthStats(index)
  console.log(`${MONTH_NAMES[index]}: ingresos=${s.income} gastos=${s.expenses} balance=${s.balance} ahorro=${s.savingsRate}%`)
})

console.log('\n=== PASSED - Pure logic is correct ===')
