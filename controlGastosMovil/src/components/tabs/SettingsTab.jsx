import { Fragment, useRef, useState } from 'react'
import { useSettings, ACCENTS } from '../../context/SettingsContext'
import { createPortal } from 'react-dom'
import NewCategoryScreen from '../ui/NewCategoryScreen'
import { DEFAULT_CATEGORIES, TYPES, categoryKey, combineCategories } from '../../data/categories'
import { useFinanceData } from '../../context/FinanceDataContext'
import {
  buildCsv, buildExportPayload, downloadText, exportErrorMessage, fetchAllTransactions, fetchExtras,
} from '../../utils/exportData'
import { localISODate } from '../../utils'

const THEMES = [
  { id: 'dark',     name: 'Oscuro' },
  { id: 'light',    name: 'Claro' },
  { id: 'pastel',   name: 'Pastel' },
  { id: 'ocean',    name: 'Océano' },
  { id: 'sunset',   name: 'Atardecer' },
  { id: 'forest',   name: 'Bosque' },
  { id: 'midnight', name: 'Medianoche' },
  { id: 'auto',     name: 'Auto' },
]

function ThemeCard({ theme, selected, onSelect }) {
  return (
    <button
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
import { useBudget } from '../../hooks/useBudget'
import { useApp } from '../../context/AppContext'
import { sendMonthlyReport } from '../../services/api'

const SUPPORT_EMAIL_DISPLAY = 'soporte@mieconomia.app'
const SUPPORT_EMAIL_REAL    = 'marioomc00@gmail.com'

function Section({ title, children }) {
  return (
    <div className="settings-section">
      {title && <div className="settings-section-title">{title}</div>}
      <div className="settings-card">{children}</div>
    </div>
  )
}

function Row({ icon, label, last, danger, wrap, cat, children }) {
  return (
    <div className={`setting-row${last ? ' last' : ''}${danger ? ' danger-row' : ''}${wrap ? ' setting-row--wrap' : ''}${cat ? ' setting-row--cat' : ''}`}>
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


const TIPO_PLURAL = { 'Gasto Variable': 'Gastos variables', 'Gasto Fijo': 'Gastos fijos', 'Ingreso': 'Ingresos' }
const TIPO_LABEL = { 'Gasto Variable': 'Variable', 'Gasto Fijo': 'Fijo', 'Ingreso': 'Ingreso' }

const LAST_VISIBLE_MSG = 'Debe quedar al menos una categoría visible de este tipo'

export default function SettingsTab() {
  const { settings, update, customCategories, removeCategory, hiddenCategories = [], setHiddenCategories } = useSettings()
  const finance = useFinanceData()
  const { allItems: budgetItems, removeItem } = useBudget()
  const { showToast } = useApp()
  const [sendingReport, setSendingReport] = useState(false)
  // Exportación: null | 'json' | 'csv' (preparando)
  const [exporting, setExporting] = useState(null)
  const [exportError, setExportError] = useState('')
  const [newCatOpen, setNewCatOpen] = useState(false)
  const newCatBtn = useRef(null)
  // Al cerrar el formulario el foco vuelve al botón que lo abrió.
  function closeNewCat() {
    setNewCatOpen(false)
    setTimeout(() => newCatBtn.current?.focus({ preventScroll: true }), 0)
  }

  const customList = ['Gasto Variable', 'Gasto Fijo', 'Ingreso']
    .flatMap(tipo => (customCategories[tipo] || []).map(c => ({ ...c, tipo })))

  function handleRemoveCategory(tipo, concepto) {
    if (window.confirm(`¿Eliminar la categoría "${concepto}"? Las transacciones ya guardadas con ella no cambian, pero dejará de aparecer para elegirla en nuevos movimientos.`)) {
      removeCategory(tipo, concepto)
    }
  }

  async function handleSendReport() {
    setSendingReport(true)
    try {
      await sendMonthlyReport()
      showToast('📧 Informe enviado a tu email')
    } catch (e) {
      showToast(e.message.includes('RESEND_API_KEY')
        ? '⚠️ Envío de email no configurado'
        : '⚠️ No se pudo enviar el informe')
    } finally {
      setSendingReport(false)
    }
  }

  // Pide los movimientos de todos los años y, según el formato, genera el fichero.
  async function runExport(kind) {
    if (exporting) return
    setExporting(kind)
    setExportError('')
    try {
      const { transactions, years, unreadable } = await fetchAllTransactions(finance?.data?.availableYears)
      const day = localISODate()
      if (kind === 'csv') {
        downloadText(buildCsv(transactions), `mi-economia-movimientos-${day}.csv`, 'text/csv;charset=utf-8')
        showToast(`📄 ${transactions.length} movimientos exportados`)
      } else {
        const extras = await fetchExtras()
        const payload = buildExportPayload({
          budget: budgetItems, settings, hiddenCategories, transactions, years, unreadable, ...extras,
        })
        downloadText(JSON.stringify(payload, null, 2), `mi-economia-${day}.json`, 'application/json')
        showToast('📤 Datos exportados')
      }
      if (unreadable) setExportError(`${unreadable} movimientos no se pudieron leer en el servidor y no están en el fichero.`)
    } catch (e) {
      setExportError(exportErrorMessage(e))
    } finally {
      setExporting(null)
    }
  }

  // ── Categorías por defecto ocultas ──
  const hiddenKeys = new Set(hiddenCategories.map(h => categoryKey(h.tipo, h.concepto)))
  const hiddenCount = DEFAULT_CATEGORIES
    ? TYPES.reduce((n, t) => n + DEFAULT_CATEGORIES[t.id].filter(c => hiddenKeys.has(categoryKey(t.id, c.concepto))).length, 0)
    : 0
  // Quedan elegibles en el tipo (por defecto visibles + propias) si se oculta `skip`
  const visibleLeft = (tipo, skipKey) => combineCategories(
    DEFAULT_CATEGORIES[tipo].filter(c => {
      const k = categoryKey(tipo, c.concepto)
      return k !== skipKey && !hiddenKeys.has(k)
    }),
    customCategories?.[tipo] || [],
  ).length

  function toggleDefaultCategory(tipo, concepto) {
    const k = categoryKey(tipo, concepto)
    if (hiddenKeys.has(k)) {
      setHiddenCategories?.(hiddenCategories.filter(h => categoryKey(h.tipo, h.concepto) !== k))
    } else {
      if (visibleLeft(tipo, k) < 1) return
      setHiddenCategories?.([...hiddenCategories, { tipo, concepto }])
    }
  }

  function showAllCategories() {
    // Solo las de las categorías por defecto; cualquier otra entrada se conserva
    const defaults = new Set(TYPES.flatMap(t => DEFAULT_CATEGORIES[t.id].map(c => categoryKey(t.id, c.concepto))))
    setHiddenCategories?.(hiddenCategories.filter(h => !defaults.has(categoryKey(h.tipo, h.concepto))))
  }

  function clearBudget() {
    if (window.confirm('¿Eliminar todas las categorías del presupuesto? Esta acción no se puede deshacer.')) {
      budgetItems.forEach(i => removeItem(i.id))
    }
  }

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
        <Row icon="🎨" label="Color de acento" last wrap>
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
        <p className="s-note">Solo cambia el símbolo; no convierte importes.</p>
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

      <Section title="Categorías personalizadas">
        {customList.length === 0 ? (
          <Row icon="🏷️" label="Aún no has creado ninguna">
            <span className="s-value-text" style={{ fontSize: "var(--fs-xs)" }}>Crea la primera con el botón de abajo</span>
          </Row>
        ) : (
          customList.map((c, i) => (
            <Row
              key={`${c.tipo}|${c.concepto}|${i}`}
              icon={c.emoji}
              label={c.concepto}
              cat
              last={false}
            >
              <span className="s-value-text" style={{ fontSize: "var(--fs-xs)", marginRight: 6 }}>{TIPO_LABEL[c.tipo]}</span>
              <button
                className="s-action-btn danger"
                onClick={() => handleRemoveCategory(c.tipo, c.concepto)}
              >
                Eliminar
              </button>
            </Row>
          ))
        )}
        <div className="settings-add-cat">
          <button type="button" ref={newCatBtn} className="s-add-cat-btn" onClick={() => setNewCatOpen(true)}>
            <span aria-hidden="true">＋</span> Nueva categoría
          </button>
        </div>
      </Section>
      {/* Portal: .profile-screen tiene transform, que encerraría el position:fixed */}
      {newCatOpen && createPortal(<NewCategoryScreen onClose={closeNewCat} />, document.body)}

      <Section title="Categorías por defecto">
        <p className="s-note s-note--top">
          Ocultar una categoría solo quita la opción de elegirla en movimientos nuevos y pendientes.
          Los movimientos ya guardados no cambian. Siempre queda al menos una visible por tipo.
        </p>
        <div className="s-hidden-head">
          <span className="s-value-text" aria-live="polite">
            {hiddenCount === 0 ? 'Ninguna oculta' : `${hiddenCount} ${hiddenCount === 1 ? 'oculta' : 'ocultas'}`}
          </span>
          <button type="button" className="s-action-btn s-touch" onClick={showAllCategories} disabled={hiddenCount === 0}>
            Mostrar todas
          </button>
        </div>
        {TYPES.map(t => (
          <div key={t.id} role="group" aria-label={`Categorías de ${TIPO_LABEL[t.id].toLowerCase()}`}>
            <div className="s-cat-group-title">{TIPO_PLURAL[t.id]}</div>
            {DEFAULT_CATEGORIES[t.id].map(c => {
              const k = categoryKey(t.id, c.concepto)
              const hidden = hiddenKeys.has(k)
              const lastOne = !hidden && visibleLeft(t.id, k) < 1
              return (
                <Fragment key={k}>
                <div className={`s-defcat-row${hidden ? ' is-hidden' : ''}`}>
                  <span className="s-defcat-name"><span aria-hidden="true">{c.emoji}</span> {c.concepto}</span>
                  <button
                    type="button"
                    className="s-action-btn s-touch"
                    onClick={() => toggleDefaultCategory(t.id, c.concepto)}
                    disabled={lastOne}
                    aria-pressed={hidden}
                    aria-label={`${hidden ? 'Mostrar' : 'Ocultar'} la categoría ${c.concepto}`}
                    aria-describedby={lastOne ? `s-last-${t.id.replace(/\W/g, '')}` : undefined}
                    title={lastOne ? LAST_VISIBLE_MSG : undefined}
                  >
                    {hidden ? 'Mostrar' : 'Ocultar'}
                  </button>
                </div>
                {lastOne && <p className="s-defcat-note" id={`s-last-${t.id.replace(/\W/g, '')}`}>{LAST_VISIBLE_MSG}</p>}
                </Fragment>
              )
            })}
          </div>
        ))}
      </Section>

      <Section title="Datos">
        <Row icon="📤" label="Exportar datos">
          <button className="s-action-btn" onClick={() => runExport('json')} disabled={!!exporting}>
            {exporting === 'json' ? 'Preparando…' : 'Exportar'}
          </button>
        </Row>
        <Row icon="📄" label="Exportar movimientos (CSV)">
          <button className="s-action-btn" onClick={() => runExport('csv')} disabled={!!exporting}>
            {exporting === 'csv' ? 'Preparando…' : 'Exportar'}
          </button>
        </Row>
        {exportError && <p className="s-note s-note--error" role="alert">{exportError}</p>}
        <Row icon="📧" label="Informe mensual por email">
          <button className="s-action-btn" onClick={handleSendReport} disabled={sendingReport}>
            {sendingReport ? 'Enviando…' : 'Enviar ahora'}
          </button>
        </Row>
        <Row icon="🗑️" label="Borrar presupuesto" danger last>
          <button className="s-action-btn danger" onClick={clearBudget}>Borrar</button>
        </Row>
      </Section>

      <Section title="Ayuda">
        <Row icon="❓" label="¿Tienes dudas o algo no funciona?">
          <span className="s-value-text" style={{ fontSize: "var(--fs-xs)" }}>Escríbenos</span>
        </Row>
        <Row icon="✉️" label="Contacto" last>
          <a
            className="s-value-text s-link"
            href={`mailto:${SUPPORT_EMAIL_REAL}?subject=${encodeURIComponent('Ayuda con Mi Economía')}`}
          >
            {SUPPORT_EMAIL_DISPLAY}
          </a>
        </Row>
      </Section>

    </div>
  )
}
