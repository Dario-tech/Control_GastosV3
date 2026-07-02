import { createContext, useContext, useEffect, useState } from 'react'

const LS_KEY = 'mi-economia-settings-v1'

export const ACCENTS = [
  { id: 'indigo',   color: '#6366f1', label: 'Índigo'   },
  { id: 'violet',   color: '#8b5cf6', label: 'Violeta'  },
  { id: 'emerald',  color: '#10b981', label: 'Esmeralda'},
  { id: 'rose',     color: '#f43f5e', label: 'Rosa'     },
  { id: 'amber',    color: '#f59e0b', label: 'Ámbar'    },
  { id: 'sky',      color: '#0ea5e9', label: 'Cielo'    },
]

const DEFAULT = {
  theme:          'dark',
  accent:         '#6366f1',
  hideAmounts:    false,
  currency:       'EUR',
  budgetAlerts:   true,
  alertThreshold: 80,
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT
  } catch {
    return DEFAULT
  }
}

function persist(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

const Ctx = createContext(null)

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load)

  function update(key, value) {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      persist(next)
      return next
    })
  }

  // Apply/remove .light class on <html>
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'light') {
      root.classList.add('light')
      return
    }
    if (settings.theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const apply = () => mq.matches ? root.classList.add('light') : root.classList.remove('light')
      apply()
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    root.classList.remove('light')
  }, [settings.theme])

  // Apply accent color as CSS variable
  useEffect(() => {
    const r = document.documentElement
    r.style.setProperty('--accent', settings.accent)
    r.style.setProperty('--accent-dim', settings.accent + '28')
  }, [settings.accent])

  return (
    <Ctx.Provider value={{ settings, update }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings() {
  return useContext(Ctx)
}
