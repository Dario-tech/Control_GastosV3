import { useSettings } from '../context/SettingsContext'

const INCOME  = { ocean: '#5eead4', sunset: '#5eea8a', forest: '#5eea8a', midnight: '#4ade80' }
const EXPENSE = { ocean: '#ff8da0', sunset: '#ff8da0', forest: '#ff9a94', midnight: '#ff7a7a' }

export function useChartColors() {
  const { settings } = useSettings()

  const isLight =
    settings.theme === 'light' ||
    (settings.theme === 'auto' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches)

  const isPastel = settings.theme === 'pastel'

  return {
    tick:         isPastel ? '#7c0f44' : isLight ? '#2c2c48' : '#d3d9ec',
    grid:         isLight || isPastel ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)',
    refLine:      isLight || isPastel ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.15)',
    cursor:       isLight || isPastel ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)',
    tooltip:      isLight || isPastel ? '#f4f4fb' : undefined,
    incomeColor:  isPastel ? '#059669' : INCOME[settings.theme] || '#5eea8a',
    expenseColor: isPastel ? '#e11d48' : EXPENSE[settings.theme] || '#ff9f98',
  }
}
