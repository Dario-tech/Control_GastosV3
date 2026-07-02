import { useSettings, ACCENTS } from '../../context/SettingsContext'
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

export default function SettingsTab() {
  const { settings, update } = useSettings()
  const { items: budgetItems, removeItem } = useBudget()
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

      <Section title="Apariencia">
        <Row icon="🌗" label="Tema">
          <Segmented
            value={settings.theme}
            onChange={v => update('theme', v)}
            options={[
              { value: 'dark',  label: '🌙 Oscuro' },
              { value: 'light', label: '☀️ Claro'  },
              { value: 'auto',  label: '⚙️ Auto'   },
            ]}
          />
        </Row>
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
