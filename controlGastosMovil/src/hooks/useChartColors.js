import { useSettings } from '../context/SettingsContext'

export function useChartColors() {
  const { settings } = useSettings()

  const isLight =
    settings.theme === 'light' ||
    (settings.theme === 'auto' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches)

  const isPastel = settings.theme === 'pastel'

  return {
    tick:         isLight || isPastel ? '#505070' : '#8c94b0',
    grid:         isLight || isPastel ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)',
    refLine:      isLight || isPastel ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.15)',
    cursor:       isLight || isPastel ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)',
    tooltip:      isLight || isPastel ? '#f4f4fb' : undefined,
    incomeColor:  isPastel ? '#f9a8d4' : '#22c55e',
    expenseColor: isPastel ? '#fb7185' : '#f43f5e',
  }
}
