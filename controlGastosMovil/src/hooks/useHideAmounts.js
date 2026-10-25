import { useSettings } from '../context/SettingsContext'

// ¿Está activo «Ocultar importes»? Para lo que CSS no alcanza (recharts).
export function useHideAmounts() {
  return !!useSettings()?.settings?.hideAmounts
}
