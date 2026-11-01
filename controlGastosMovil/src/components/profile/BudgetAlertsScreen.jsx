import { useState } from 'react'
import { useSettings } from '../../context/SettingsContext'
import { useBudget } from '../../hooks/useBudget'
import { ConfirmSheet } from '../ui/FormKit'
import { Section, Row, Toggle } from './ui'

export default function BudgetAlertsScreen() {
  const { settings, update } = useSettings()
  const { allItems: budgetItems, removeItem } = useBudget()
  const [confirmClear, setConfirmClear] = useState(false)
  const n = budgetItems.length

  function clearBudget() {
    budgetItems.forEach(i => removeItem(i.id))
    setConfirmClear(false)
  }

  return (
    <>
      <Section title="Alertas de gasto">
        <Row icon="🔔" label="Alertas de gasto">
          <Toggle label="Alertas de gasto" value={settings.budgetAlerts} onChange={v => update('budgetAlerts', v)} />
        </Row>
        <div className="pf-slider-row">
          <label className="pf-slider-label" htmlFor="pf-threshold">
            <span>Avisar al llegar al</span>
            <strong>{settings.alertThreshold}%</strong>
          </label>
          <input
            id="pf-threshold"
            type="range"
            min="50" max="100" step="5"
            value={settings.alertThreshold}
            onChange={e => update('alertThreshold', Number(e.target.value))}
            className="s-slider pf-slider"
            disabled={!settings.budgetAlerts}
            aria-label="Umbral de alerta"
            aria-valuetext={`${settings.alertThreshold}% del presupuesto`}
          />
        </div>
        <p className="s-note">
          {settings.budgetAlerts
            ? 'Te avisamos cuando una categoría llegue a este porcentaje de su presupuesto.'
            : 'Activa las alertas para elegir el umbral.'}
        </p>
      </Section>

      <Section title="Presupuesto">
        <div className="pf-danger-zone">
          <p className="pf-danger-text">
            {n === 0 ? 'Aún no tienes categorías en el presupuesto.' : `Tienes ${n} ${n === 1 ? 'categoría' : 'categorías'} en el presupuesto.`}
          </p>
          <button type="button" className="pf-quiet-danger" onClick={() => setConfirmClear(true)} disabled={n === 0}>
            Borrar presupuesto
          </button>
        </div>
      </Section>

      {confirmClear && (
        <ConfirmSheet
          title="¿Borrar el presupuesto?"
          message="Se eliminarán todas las categorías del presupuesto. Esta acción no se puede deshacer."
          confirmLabel="Borrar presupuesto"
          onConfirm={clearBudget}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </>
  )
}
