import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { CUSTOM_CATS_KEY, CATS_CACHE_KEY, PREFS_CACHE_KEY } from '../utils/storageKeys'
import { fetchPrefs, putPref } from '../services/prefsApi'
import { fetchCategories, createCategory, deleteCategory, importCategories } from '../services/categoriesApi'
import { importLegacy, legacyHiddenFor, readLegacyCats, readLegacyBudgets, readLegacySettings, hasLegacyTour } from '../utils/legacyImport'
import { newId } from '../utils/id'

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

const KIND_LABEL = {
  settings: 'los ajustes', budgets: 'los presupuestos', hidden_categories: 'las categorías ocultas', tour: 'la guía',
}
const TMP = 'tmp-'

// Un usuario nuevo en el dispositivo parte de los ajustes por defecto; si hay
// ajustes antiguos del móvil (aún sin importar) se usan solo para pintar.
function initialPrefs(email) {
  const cache = readPrefsCache(email)
  const budgets = cache.budgets ?? readLegacyBudgets() ?? []
  return {
    settings: { ...DEFAULT, ...(cache.settings ?? readLegacySettings() ?? {}) },
    budgets:  Array.isArray(budgets) ? budgets : [],
    hidden:   Array.isArray(cache.hidden) ? cache.hidden : [],
    tour:     cache.tour ?? (hasLegacyTour() ? 'legacy' : null),
  }
}

function readPrefsCache(email) {
  if (!email) return {}
  try {
    const c = JSON.parse(localStorage.getItem(PREFS_CACHE_KEY))
    return c && c.email === email ? c : {}
  } catch { return {} }
}

function readCatsCache(email) {
  if (!email) return null
  try {
    const c = JSON.parse(localStorage.getItem(CATS_CACHE_KEY))
    return c && c.email === email && Array.isArray(c.categories) ? c.categories : null
  } catch { return null }
}

function initialCats(email) {
  const cached = readCatsCache(email)
  if (cached) return cached
  return email ? (readLegacyCats() || []) : []
}

// Forma que viaja al servidor (budgets es un objeto; el resto, tal cual)
function toWire(kind, value) {
  if (kind === 'budgets') return { version: 3, items: value }
  if (kind === 'tour') return { seen_at: value }
  return value
}

function fromWire(kind, data) {
  if (kind === 'budgets') return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])
  if (kind === 'tour') return data?.seen_at || 'visto'
  if (kind === 'settings') return { ...DEFAULT, ...(data || {}) }
  return Array.isArray(data) ? data : []
}

const PREF_STATE_KEY = { settings: 'settings', budgets: 'budgets', hidden_categories: 'hidden', tour: 'tour' }

function groupByTipo(list) {
  const out = { 'Gasto Variable': [], 'Gasto Fijo': [], 'Ingreso': [] }
  for (const c of list) if (out[c.tipo]) out[c.tipo].push(c)
  return out
}

const Ctx = createContext(null)

export function SettingsProvider({ children }) {
  const auth  = useAuth()
  const user  = auth?.user ?? null
  const email = user?.email ?? null

  const [prefs, setPrefs] = useState(() => initialPrefs(email))
  const [cats, setCatsState] = useState(() => initialCats(email))
  const [loaded, setLoaded] = useState(false)   // GET /api/prefs ya respondió bien
  const [notice, setNotice] = useState(null)

  const prefsRef = useRef(prefs)
  const catsRef  = useRef(cats)
  const emailRef = useRef(email)
  const userRef  = useRef(user)
  emailRef.current = email
  userRef.current  = user
  const genRef       = useRef(0)   // cambia con cada usuario: descarta respuestas viejas
  const seqs         = useRef({})
  const chains       = useRef({})
  const confirmed    = useRef({})  // último valor que el servidor aceptó
  const pendingAdds  = useRef(new Map())

  const notify = useCallback((msg) => setNotice({ n: Date.now(), msg }), [])

  function writePrefsCache() {
    if (!emailRef.current) return
    try { localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify({ email: emailRef.current, ...prefsRef.current })) } catch { /* no-op */ }
  }

  function writeCatsCache() {
    if (!emailRef.current) return
    const real = catsRef.current.filter(c => c.id && !String(c.id).startsWith(TMP))
    try { localStorage.setItem(CATS_CACHE_KEY, JSON.stringify({ email: emailRef.current, categories: real })) } catch { /* no-op */ }
  }

  function setCats(next) {
    catsRef.current = next
    setCatsState(next)
    writeCatsCache()
  }

  function setPrefsLocal(patch) {
    prefsRef.current = { ...prefsRef.current, ...patch }
    setPrefs(prefsRef.current)
    writePrefsCache()
  }

  // Cambio de usuario (login, logout, otra cuenta): se descarta lo del anterior
  // y se carga del servidor. Un 401 cierra la sesión pero no borra datos aquí.
  const prevEmail = useRef(email)
  useEffect(() => {
    const changed = prevEmail.current !== email
    prevEmail.current = email
    const gen = ++genRef.current
    seqs.current = {}
    chains.current = {}
    pendingAdds.current = new Map()
    const stale = () => gen !== genRef.current

    if (changed) {
      const p = initialPrefs(email)
      prefsRef.current = p
      setPrefs(p)
      setCats(initialCats(email))
      setLoaded(false)
    }
    confirmed.current = { settings: prefsRef.current.settings, budgets: prefsRef.current.budgets, hidden_categories: prefsRef.current.hidden, tour: prefsRef.current.tour }
    if (!email) return

    ;(async () => {
      const [pr, cr] = await Promise.allSettled([fetchPrefs(), fetchCategories()])
      if (stale()) return
      const server = pr.status === 'fulfilled' && pr.value && typeof pr.value === 'object' ? pr.value : null

      const imp = await importLegacy({
        user: userRef.current,
        prefs: server,
        api: { importCategories, putPref },
      })
      if (stale()) return

      // Categorías propias
      let list = imp.categories ?? (cr.status === 'fulfilled' && Array.isArray(cr.value?.categories) ? cr.value.categories : null)
      if (list) {
        if (imp.failed.includes('categories')) {
          // Importación pendiente: las antiguas siguen visibles hasta que suba.
          const old = readLegacyCats() || []
          const have = new Set(list.map(c => `${c.tipo}|${c.concepto}`))
          list = [...list, ...old.filter(c => !have.has(`${c.tipo}|${c.concepto}`))]
        }
        // Altas en curso durante la carga: se conservan encima de la lista.
        const inFlight = catsRef.current.filter(c => String(c.id).startsWith(TMP) && !list.some(x => x.tipo === c.tipo && x.concepto === c.concepto))
        setCats([...list, ...inFlight])
      }

      // Preferencias
      if (server) {
        const patch = {}
        for (const kind of Object.keys(PREF_STATE_KEY)) {
          if (seqs.current[kind]) continue // el usuario ya lo ha cambiado durante la carga
          const sk = PREF_STATE_KEY[kind]
          const wire = imp.applied[kind] ?? server[kind]
          let value
          if (wire != null) {
            value = fromWire(kind, wire)
          } else if (imp.failed.includes(kind)) {
            value = kind === 'hidden_categories' ? legacyHiddenFor(userRef.current?.name) : prefsRef.current[sk]
          } else {
            value = kind === 'settings' ? { ...DEFAULT } : kind === 'tour' ? null : []
          }
          patch[sk] = value
          if (wire != null || !imp.failed.includes(kind)) confirmed.current[kind] = value
        }
        setPrefsLocal(patch)
        setLoaded(true)
      }
    })()
  }, [email])

  // Escritura optimista de una preferencia: se pinta ya, se guarda en la caché
  // y se envía el documento completo en orden. Si falla, vuelve al último valor
  // que aceptó el servidor y se avisa.
  function commit(kind, next) {
    const sk = PREF_STATE_KEY[kind]
    const gen = genRef.current
    setPrefsLocal({ [sk]: next })
    const seq = (seqs.current[kind] = (seqs.current[kind] || 0) + 1)
    chains.current[kind] = (chains.current[kind] || Promise.resolve()).then(async () => {
      if (gen !== genRef.current || seq < seqs.current[kind]) return
      const sent = prefsRef.current[sk]
      try {
        await putPref(kind, toWire(kind, sent))
        if (gen === genRef.current) confirmed.current[kind] = sent
      } catch (e) {
        if (gen !== genRef.current || e?.status === 401) return
        if (seq === seqs.current[kind]) {
          if (kind in confirmed.current) setPrefsLocal({ [sk]: confirmed.current[kind] })
          notify(`No se pudo guardar ${KIND_LABEL[kind]} en el servidor. Se ha deshecho el cambio.`)
        }
      }
    })
  }

  function update(key, value) {
    commit('settings', { ...prefsRef.current.settings, [key]: value })
  }

  // Presupuestos: fn recibe la lista actual y devuelve la nueva
  const updateBudgets = useCallback((fn) => {
    commit('budgets', fn(prefsRef.current.budgets))
  }, [])

  const markTourSeen = useCallback(() => {
    if (prefsRef.current.tour) return
    commit('tour', new Date().toISOString())
  }, [])

  // ── Categorías propias ────────────────────────────────────────────────────
  const addCategory = useCallback((tipo, item) => {
    const concepto = String(item.concepto || '').trim()
    if (!concepto) return
    if (catsRef.current.some(c => c.tipo === tipo && c.concepto === concepto)) return
    const gen = genRef.current
    const tmp = { id: `${TMP}${newId()}`, tipo, concepto, emoji: item.emoji }
    setCats([...catsRef.current, tmp])
    const p = createCategory({ tipo, concepto, emoji: item.emoji })
      .then(created => {
        if (gen !== genRef.current) return null
        setCats(catsRef.current.map(c => c.id === tmp.id ? created : c))
        return created
      })
      .catch(async e => {
        if (gen !== genRef.current || e?.status === 401) return null
        if (e?.status === 409) {
          // Ya existía en el servidor: nos quedamos con su versión.
          try {
            const { categories } = await fetchCategories()
            if (gen === genRef.current && Array.isArray(categories)) {
              const mine = categories.find(c => c.tipo === tipo && c.concepto === concepto)
              setCats(mine ? catsRef.current.map(c => c.id === tmp.id ? mine : c) : catsRef.current.filter(c => c.id !== tmp.id))
            }
          } catch { /* se queda como está */ }
          return null
        }
        setCats(catsRef.current.filter(c => c.id !== tmp.id))
        notify(`No se pudo crear la categoría «${concepto}». Se ha deshecho el cambio.`)
        return null
      })
      .finally(() => pendingAdds.current.delete(tmp.id))
    pendingAdds.current.set(tmp.id, p)
  }, [notify])

  const removeCategory = useCallback(async (tipo, concepto) => {
    let target = catsRef.current.find(c => c.tipo === tipo && c.concepto === concepto)
    if (!target) return
    const gen = genRef.current
    if (!target.id) {
      // Antigua, aún sin importar: se quita también de la clave antigua para
      // que la importación no la resucite.
      setCats(catsRef.current.filter(c => c !== target))
      const left = readLegacyCats()
      if (Array.isArray(left)) {
        const keep = left.filter(c => !(c.tipo === tipo && c.concepto === concepto))
        try {
          if (keep.length) localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(groupByTipo(keep)))
          else localStorage.removeItem(CUSTOM_CATS_KEY)
        } catch { /* no-op */ }
      }
      return
    }
    if (String(target.id).startsWith(TMP)) {
      const created = await pendingAdds.current.get(target.id)
      if (gen !== genRef.current) return
      target = created || catsRef.current.find(c => c.tipo === tipo && c.concepto === concepto)
      if (!target || String(target.id).startsWith(TMP)) return
    }
    const removed = target
    const idx = catsRef.current.findIndex(c => c.tipo === tipo && c.concepto === concepto)
    setCats(catsRef.current.filter(c => !(c.tipo === tipo && c.concepto === concepto)))
    try {
      await deleteCategory(removed.id)
    } catch (e) {
      if (gen !== genRef.current || e?.status === 401 || e?.status === 404) return
      const next = [...catsRef.current]
      next.splice(Math.min(Math.max(idx, 0), next.length), 0, removed)
      setCats(next)
      notify(`No se pudo eliminar la categoría «${concepto}». Se ha deshecho el cambio.`)
    }
  }, [notify])

  const customCategories = useMemo(() => groupByTipo(cats), [cats])
  const settings = prefs.settings

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
    <Ctx.Provider value={{
      settings, update, customCategories, addCategory, removeCategory,
      hiddenCategories: prefs.hidden,
      budgetItems: prefs.budgets, updateBudgets,
      tourSeen: !!prefs.tour, prefsLoaded: loaded, markTourSeen,
      syncNotice: notice,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings() {
  return useContext(Ctx)
}
