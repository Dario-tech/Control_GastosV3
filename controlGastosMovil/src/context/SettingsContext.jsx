import { createContext, useContext, useEffect, useState } from 'react'

const LS_KEY      = 'mi-economia-settings-v1'
const LS_CATS_KEY = 'mi-economia-custom-cats-v1'

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

const EMPTY_CATS = { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT
  } catch {
    return DEFAULT
  }
}

function loadCats() {
  try {
    const raw = localStorage.getItem(LS_CATS_KEY)
    return raw ? { ...EMPTY_CATS, ...JSON.parse(raw) } : EMPTY_CATS
  } catch {
    return EMPTY_CATS
  }
}

function persist(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

function persistCats(c) {
  localStorage.setItem(LS_CATS_KEY, JSON.stringify(c))
}

const Ctx = createContext(null)

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load)
  const [customCategories, setCustomCategories] = useState(loadCats)

  function update(key, value) {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      persist(next)
      return next
    })
  }

  function addCategory(tipo, item) {
    setCustomCategories(prev => {
      const list = prev[tipo] || []
      if (list.some(c => c.concepto === item.concepto)) return prev
      const next = { ...prev, [tipo]: [...list, item] }
      persistCats(next)
      return next
    })
  }

  function removeCategory(tipo, concepto) {
    setCustomCategories(prev => {
      const next = { ...prev, [tipo]: (prev[tipo] || []).filter(c => c.concepto !== concepto) }
      persistCats(next)
      return next
    })
  }

  // Apply theme class on <html>
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'pastel')

    if (settings.theme === 'light') {
      root.classList.add('light')
    } else if (settings.theme === 'pastel') {
      root.classList.add('pastel')
    } else if (settings.theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const apply = () => mq.matches ? root.classList.add('light') : root.classList.remove('light')
      apply()
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [settings.theme])

  // Apply accent color as CSS variable
  useEffect(() => {
    const r = document.documentElement
    r.style.setProperty('--accent', settings.accent)
    r.style.setProperty('--accent-dim', settings.accent + '28')
  }, [settings.accent])

  return (
    <Ctx.Provider value={{ settings, update, customCategories, addCategory, removeCategory }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings() {
  return useContext(Ctx)
}
