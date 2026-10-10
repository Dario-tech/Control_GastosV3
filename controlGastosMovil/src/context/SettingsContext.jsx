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

// Luminancia relativa WCAG de un color #rrggbb
function luminance(hex) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

const ON_ACCENT_DARK  = '#06121f'
const ON_ACCENT_LIGHT = '#ffffff'

function contrast(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

// Texto sobre el acento: el candidato (blanco o casi negro) con MAYOR ratio real
export function onAccentColor(hex) {
  const L = luminance(hex)
  return contrast(L, luminance(ON_ACCENT_LIGHT)) >= contrast(L, luminance(ON_ACCENT_DARK))
    ? ON_ACCENT_LIGHT : ON_ACCENT_DARK
}

export const EXTRA_THEMES = ['ocean', 'sunset', 'forest', 'midnight']

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
    root.classList.remove('light', 'pastel', ...EXTRA_THEMES)

    if (settings.theme === 'light') {
      root.classList.add('light')
    } else if (settings.theme === 'pastel') {
      root.classList.add('pastel')
    } else if (EXTRA_THEMES.includes(settings.theme)) {
      root.classList.add(settings.theme)
    } else if (settings.theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const apply = () => mq.matches ? root.classList.add('light') : root.classList.remove('light')
      apply()
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [settings.theme])

  // Sincroniza <meta name="theme-color"> con el fondo del tema activo
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    const id = requestAnimationFrame(() => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      if (bg) meta.setAttribute('content', bg)
    })
    return () => cancelAnimationFrame(id)
  }, [settings.theme])

  // Apply accent color as CSS variable
  useEffect(() => {
    const r = document.documentElement
    r.style.setProperty('--accent', settings.accent)
    r.style.setProperty('--accent-dim', settings.accent + '28')
    r.style.setProperty('--on-accent', onAccentColor(settings.accent))
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
