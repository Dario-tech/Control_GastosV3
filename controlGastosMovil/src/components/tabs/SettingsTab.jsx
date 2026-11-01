import { useState } from 'react'
import { useSettings } from '../../context/SettingsContext'
import { Section, Row, NavRow, Toggle } from '../profile/ui'
import AppearanceScreen, { THEMES } from '../profile/AppearanceScreen'
import CategoriesScreen from '../profile/CategoriesScreen'
import BudgetAlertsScreen from '../profile/BudgetAlertsScreen'
import DataScreen from '../profile/DataScreen'
import HelpScreen from '../profile/HelpScreen'

/* «Perfil y ajustes» al estilo de los Ajustes de iOS: una pantalla principal
   corta (`home`) y una subpantalla por área. ProfilePanel pone la barra
   superior (atrás/título) y puede controlar `screen`; sin él, el estado es
   interno. */
export const SCREENS = {
  home:       { title: 'Perfil y ajustes' },
  appearance: { title: 'Apariencia' },
  categories: { title: 'Categorías' },
  budget:     { title: 'Presupuestos y alertas' },
  data:       { title: 'Datos y exportar' },
  help:       { title: 'Ayuda' },
}

export default function SettingsTab({
  screen: screenProp, onNavigate, initialScreen = 'home',
  onOpenShortcut, onShowGuide, onLogout,
}) {
  const [inner, setInner] = useState(initialScreen)
  const screen = screenProp ?? inner
  const go = onNavigate ?? setInner

  if (screen === 'appearance') return <div className="tab-panel pf-screen"><AppearanceScreen /></div>
  if (screen === 'categories') return <div className="tab-panel pf-screen"><CategoriesScreen /></div>
  if (screen === 'budget')     return <div className="tab-panel pf-screen"><BudgetAlertsScreen /></div>
  if (screen === 'data')       return <div className="tab-panel pf-screen"><DataScreen /></div>
  if (screen === 'help')       return <div className="tab-panel pf-screen"><HelpScreen onShowGuide={onShowGuide} /></div>
  return <Home go={go} onOpenShortcut={onOpenShortcut} onLogout={onLogout} />
}

function Home({ go, onOpenShortcut, onLogout }) {
  const { settings, update, customCategories } = useSettings()
  const themeName = THEMES.find(t => t.id === settings.theme)?.name ?? ''
  const customCount = ['Gasto Variable', 'Gasto Fijo', 'Ingreso']
    .reduce((n, t) => n + (customCategories?.[t]?.length || 0), 0)

  return (
    <div className="tab-panel pf-screen pf-home">
      <Section>
        <NavRow id="appearance" icon="🎨" label="Apariencia" value={themeName} onClick={() => go('appearance')} />
        <NavRow id="categories" icon="🏷️" label="Categorías" value={customCount ? `${customCount} propias` : ''} onClick={() => go('categories')} />
        <NavRow
          id="budget" icon="🔔" label="Presupuestos y alertas"
          value={settings.budgetAlerts ? `Al ${settings.alertThreshold}%` : 'Sin alertas'}
          onClick={() => go('budget')}
        />
        {onOpenShortcut && (
          <NavRow id="shortcut" icon="📲" label="Pagos automáticos" value="Apple Pay" onClick={onOpenShortcut} />
        )}
        <NavRow id="data" icon="📤" label="Datos y exportar" onClick={() => go('data')} />
        <NavRow id="help" icon="❓" label="Ayuda" onClick={() => go('help')} last />
      </Section>

      <div className="pf-bottom">
      <Section>
        <Row icon="👁️" label="Ocultar importes" last>
          <Toggle label="Ocultar importes" value={!!settings.hideAmounts} onChange={v => update('hideAmounts', v)} />
        </Row>
      </Section>

      {onLogout && (
        <div className="pf-logout-wrap">
          <button type="button" className="pf-logout" onClick={onLogout}>Cerrar sesión</button>
        </div>
      )}
      </div>
      <p className="build-marker-inline" onClick={() => { window.location.href = "/?diag=1" }}>build {__BUILD_SHA__} · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}</p>
    </div>
  )
}
