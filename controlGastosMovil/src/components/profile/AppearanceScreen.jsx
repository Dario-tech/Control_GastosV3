import { useSettings, ACCENTS } from '../../context/SettingsContext'
import { Section, Row, Segmented } from './ui'

export const THEMES = [
  { id: 'dark',     name: 'Oscuro' },
  { id: 'light',    name: 'Claro' },
  { id: 'pastel',   name: 'Pastel' },
  { id: 'ocean',    name: 'Océano' },
  { id: 'sunset',   name: 'Atardecer' },
  { id: 'forest',   name: 'Bosque' },
  { id: 'midnight', name: 'Medianoche' },
  { id: 'auto',     name: 'Auto' },
]

export const CURRENCIES = [
  { value: 'EUR', label: '€', name: 'Euro' },
  { value: 'USD', label: '$', name: 'Dólar' },
  { value: 'GBP', label: '£', name: 'Libra' },
]

function ThemeCard({ theme, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`theme-card${selected ? ' active' : ''}`}
      onClick={() => onSelect(theme.id)}
      aria-pressed={selected}
      aria-label={`Tema ${theme.name}`}
    >
      <span className={`theme-dot theme-dot-${theme.id}`} />
      <span className="theme-card-label">
        <span className="theme-card-name">{theme.name}</span>
      </span>
    </button>
  )
}

export default function AppearanceScreen() {
  const { settings, update } = useSettings()
  return (
    <>
      <Section title="Tema">
        <div className="theme-grid">
          {THEMES.map(t => (
            <ThemeCard key={t.id} theme={t} selected={settings.theme === t.id} onSelect={v => update('theme', v)} />
          ))}
        </div>
      </Section>

      <Section title="Color de acento">
        <div className="pf-accents" role="group" aria-label="Color de acento">
          {ACCENTS.map(a => (
            <button
              type="button"
              key={a.id}
              className={`accent-swatch pf-swatch${settings.accent === a.color ? ' active' : ''}`}
              style={{ background: a.color }}
              onClick={() => update('accent', a.color)}
              aria-pressed={settings.accent === a.color}
              aria-label={`Color ${a.label}`}
              title={a.label}
            />
          ))}
        </div>
      </Section>

      <Section title="Moneda">
        <Row icon="💱" label="Moneda" last>
          <Segmented
            label="Moneda"
            value={settings.currency}
            onChange={v => update('currency', v)}
            options={CURRENCIES}
          />
        </Row>
        <p className="s-note">Solo cambia el símbolo; no convierte importes.</p>
      </Section>
    </>
  )
}
