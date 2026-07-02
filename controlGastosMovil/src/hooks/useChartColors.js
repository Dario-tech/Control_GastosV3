import { useSettings } from '../context/SettingsContext'

export function useChartColors() {
  const { settings } = useSettings()

  const isLight =
    settings.theme === 'light' ||
    (settings.theme === 'auto' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches)

  return {
    tick:      isLight ? '#505070' : '#8c94b0',
    grid:      isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)',
    refLine:   isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.15)',
    cursor:    isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)',
    tooltip:   isLight ? '#f4f4fb' : undefined,
  }
}
