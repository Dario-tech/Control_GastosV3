import { useState } from 'react'
import { useSettings, ACCENTS } from '../../context/SettingsContext'
import { EMOJI_SUGGESTIONS } from '../../data/categories'

const THEMES = [
  {
    id: 'dark',
    name: 'Oscuro',
    emoji: '🌙',
    bg: '#07070f', surface: '#111120', accent: '#6366f1', bar: '#22c55e',
  },
  {
    id: 'light',
    name: 'Claro',
    emoji: '☀️',
    bg: '#f0f0f8', surface: '#ffffff', accent: '#6366f1', bar: '#22c55e',
  },
  {
    id: 'pastel',
    name: 'Pastel',
    emoji: '🌸',
    bg: '#fff0f7', surface: '#ffffff', accent: '#ec4899', bar: '#f9a8d4',
  },
  {
    id: 'auto',
    name: 'Auto',
    emoji: '⚙️',
    bg: '#888', surface: '#aaa', accent: '#6366f1', bar: '#22c55e',
  },
]

function ThemeCard({ theme, selected, onSelect }) {
  const isAuto = theme.id === 'auto'
  return (
    <button
      className={`theme-card${selected ? ' active' : ''}`}
      onClick={() => onSelect(theme.id)}
    >
      <div className="theme-card-preview" style={{ background: isAuto ? 'linear-gradient(135deg, #111120 50%, #f0f0f8 50%)' : theme.bg }}>
        <div className="theme-card-preview-surface" style={{ background: isAuto ? 'transparent' : theme.surface }}>
          <div className="theme-card-preview-bar" style={{ background: isAuto ? '#6366f1' : theme.accent, width: '65%' }} />
          <div className="theme-card-preview-bar" style={{ background: isAuto ? '#22c55e' : theme.bar, width: '40%', opacity: 0.7 }} />
          <div className="theme-card-preview-bar" style={{ background: isAuto ? '#6366f1' : theme.accent, width: '80%', opacity: 0.4 }} />
        </div>
      </div>
      <div className="theme-card-label">
        <span className="theme-card-emoji">{theme.emoji}</span>
        <span className="theme-card-name">{theme.name}</span>
        {selected && (
          <svg className="theme-card-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 8l3.5 3.5L13 5"/>
          </svg>
        )}
      </div>
    </button>
  )
}
import { useBudget } from '../../hooks/useBudget'
import { useFinanceData } from '../../context/FinanceDataContext'

function Section({ title, children }) {
  return (
    <div className="settings-section">
      {title && <div className="settings-section-title">{title}</div>}
      <div className="settings-card">{children}</div>
    </div>
  )
}

function Row({ icon, label, last, danger, children }) {
  return (
    <div className={`setting-row${last ? ' last' : ''}${danger ? ' danger-row' : ''}`}>
      <div className="setting-row-left">
        <span className="setting-icon">{icon}</span>
        <span className={`setting-label${danger ? ' danger-label' : ''}`}>{label}</span>
      </div>
      <div className="setting-row-right">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      className={`s-toggle${value ? ' on' : ''}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <span className="s-toggle-thumb" />
    </button>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="s-segmented">
      {options.map(o => (
        <button
          key={o.value}
          className={`s-seg-btn${value === o.value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const CAT_TIPOS = ['Gasto Variable', 'Gasto Fijo', 'Ingreso']

function CustomCategoriesSection() {
  const { customCategories, addCategory, removeCategory } = useSettings()
  const [activeTipo, setActiveTipo] = useState('Gasto Variable')
  const [newEmoji, setNewEmoji]     = useState('💶')
  const [newName, setNewName]       = useState('')
  const [err, setErr]               = useState('')

  function handleAdd() {
    const name = newName.trim()
    if (!name) { setErr('Escribe un nombre'); return }
    addCategory(activeTipo, { concepto: name, emoji: newEmoji })
    setNewName('')
    setErr('')
  }

  const list = customCategories[activeTipo] || []

  return (
    <div className="settings-section">
      <div className="settings-section-title">Mis categorías</div>
      <div className="settings-card">
        <div className="cat-tipo-tabs">
          {CAT_TIPOS.map(t => (
            <button key={t} className={`cat-tipo-tab${activeTipo === t ? ' active' : ''}`}
              onClick={() => setActiveTipo(t)}>
              {t === 'Gasto Variable' ? 'Variable' : t === 'Gasto Fijo' ? 'Fijo' : 'Ingreso'}
            </button>
          ))}
        </div>

        {list.length === 0 && (
          <p className="cat-empty-hint">Sin categorías personalizadas</p>
        )}

        {list.map(c => (
          <div key={c.concepto} className="cat-custom-row">
            <span className="cat-custom-emoji">{c.emoji}</span>
            <span className="cat-custom-name">{c.concepto}</span>
            <button className="cat-delete-btn" onClick={() => removeCategory(activeTipo, c.concepto)}
              aria-label="Eliminar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
              </svg>
            </button>
          </div>
        ))}

        <div className="cat-add-row">
          <div className="cat-emoji-scroll">
            {EMOJI_SUGGESTIONS.map(e => (
              <button key={e} className={`cat-emoji-btn${newEmoji === e ? ' active' : ''}`}
                onClick={() => setNewEmoji(e)}>{e}</button>
            ))}
          </div>
          <div className="cat-add-input-row">
            <span className="cat-selected-emoji">{newEmoji}</span>
            <input
              className="cat-name-input"
              placeholder="Nombre de la categoría"
              value={newName}
              onChange={e => { setNewName(e.target.value); setErr('') }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              maxLength={32}
            />
            <button className="cat-add-btn" onClick={handleAdd}>Añadir</button>
          </div>
          {err && <p className="cat-err">{err}</p>}
        </div>
      </div>
    </div>
  )
}

export default function SettingsTab() {
  const { settings, update } = useSettings()
  const { allItems: budgetItems, removeItem } = useBudget()
  const { status, lastUpdated, errorMsg, refresh } = useFinanceData()

  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      budget:     budgetItems,
      settings,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `mi-economia-${new Date().toISOString().slice(0, 10)}.json`,
    })
    a.click()
    URL.revokeObjectURL(url)
  }

  function clearBudget() {
    if (window.confirm('¿Eliminar todas las categorías del presupuesto? Esta acción no se puede deshacer.')) {
      budgetItems.forEach(i => removeItem(i.id))
    }
  }

  const backendStatus = {
    live:    '✅ Conectado al backend',
    loading: '⏳ Conectando…',
    offline: '⚠️ Backend no disponible — usando datos de ejemplo',
    idle:    '⚙️ Backend activo — Google Sheets pendiente de configurar',
    error:   `⚠️ ${errorMsg || 'Error de conexión'}`,
  }[status] ?? ''

  return (
    <div className="tab-panel">

      <Section title="Temas">
        <div className="theme-grid">
          {THEMES.map(t => (
            <ThemeCard
              key={t.id}
              theme={t}
              selected={settings.theme === t.id}
              onSelect={v => update('theme', v)}
            />
          ))}
        </div>
      </Section>

      <Section title="Apariencia">
        <Row icon="🎨" label="Color de acento" last>
          <div className="accent-swatches">
            {ACCENTS.map(a => (
              <button
                key={a.id}
                className={`accent-swatch${settings.accent === a.color ? ' active' : ''}`}
                style={{ background: a.color }}
                onClick={() => update('accent', a.color)}
                title={a.label}
              />
            ))}
          </div>
        </Row>
      </Section>

      <Section title="General">
        <Row icon="👁️" label="Ocultar importes">
          <Toggle value={settings.hideAmounts} onChange={v => update('hideAmounts', v)} />
        </Row>
        <Row icon="💱" label="Moneda" last>
          <Segmented
            value={settings.currency}
            onChange={v => update('currency', v)}
            options={[
              { value: 'EUR', label: '€' },
              { value: 'USD', label: '$' },
              { value: 'GBP', label: '£' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Presupuesto">
        <Row icon="🔔" label="Alertas de gasto">
          <Toggle value={settings.budgetAlerts} onChange={v => update('budgetAlerts', v)} />
        </Row>
        <Row icon="⚠️" label={`Umbral de alerta: ${settings.alertThreshold}%`} last>
          <input
            type="range"
            min="50" max="100" step="5"
            value={settings.alertThreshold}
            onChange={e => update('alertThreshold', Number(e.target.value))}
            className="s-slider"
            disabled={!settings.budgetAlerts}
          />
        </Row>
      </Section>

      <CustomCategoriesSection />

      <Section title="Backend">
        <Row icon="🔌" label="Estado" last>
          <span className="s-value-text" style={{ fontSize: '0.75rem' }}>{backendStatus}</span>
        </Row>
        {status === 'live' && lastUpdated && (
          <div className="api-key-ok">
            Actualizado a las {lastUpdated.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            <button className="s-action-btn" style={{ marginLeft: 10 }} onClick={refresh}>
              Recargar
            </button>
          </div>
        )}
      </Section>

      <Section title="Datos">
        <Row icon="📤" label="Exportar datos">
          <button className="s-action-btn" onClick={exportData}>Exportar</button>
        </Row>
        <Row icon="🗑️" label="Borrar presupuesto" danger last>
          <button className="s-action-btn danger" onClick={clearBudget}>Borrar</button>
        </Row>
      </Section>

      <Section title="Sobre la app">
        <Row icon="📱" label="Versión">
          <span className="s-value-text">1.0.0</span>
        </Row>
        <Row icon="👨‍💻" label="Desarrollador">
          <span className="s-value-text">Mario</span>
        </Row>
        <Row icon="⚛️" label="Frontend">
          <span className="s-value-text">React + Vite</span>
        </Row>
        <Row icon="🐍" label="Backend" last>
          <span className="s-value-text">Python + FastAPI</span>
        </Row>
      </Section>

    </div>
  )
}
