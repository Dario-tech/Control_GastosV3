/* Piezas de presentación compartidas por la pantalla principal del perfil y
   sus subpantallas (clases `pf-*` y las `settings-*`/`s-*` de siempre). */

export const TIPO_PLURAL = { 'Gasto Variable': 'Gastos variables', 'Gasto Fijo': 'Gastos fijos', 'Ingreso': 'Ingresos' }
export const TIPO_LABEL = { 'Gasto Variable': 'Variable', 'Gasto Fijo': 'Fijo', 'Ingreso': 'Ingreso' }

export function Section({ title, children }) {
  return (
    <div className="settings-section">
      {title && <h2 className="settings-section-title">{title}</h2>}
      <div className="settings-card">{children}</div>
    </div>
  )
}

/* Fila simple: icono + etiqueta a la izquierda, control a la derecha. */
export function Row({ icon, label, last, wrap, children }) {
  return (
    <div className={`pf-row${last ? ' last' : ''}${wrap ? ' pf-row--wrap' : ''}`}>
      <span className="pf-row-left">
        {icon && <span className="pf-row-icon" aria-hidden="true">{icon}</span>}
        <span className="pf-row-label">{label}</span>
      </span>
      <span className="pf-row-right">{children}</span>
    </div>
  )
}

/* Fila que abre una subpantalla: icono, título, valor actual y chevron. */
export function NavRow({ icon, label, value, onClick, last, id, ...rest }) {
  return (
    <button type="button" className={`pf-row pf-nav-row${last ? ' last' : ''}`} onClick={onClick} data-pf-row={id} {...rest}>
      <span className="pf-row-left">
        <span className="pf-row-icon" aria-hidden="true">{icon}</span>
        <span className="pf-row-label">{label}</span>
      </span>
      <span className="pf-row-right">
        {value && <span className="pf-row-value">{value}</span>}
        <svg className="pf-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  )
}

export function Toggle({ value, onChange, label }) {
  return (
    <button
      type="button"
      className={`s-toggle${value ? ' on' : ''}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      aria-label={label}
    >
      <span className="s-toggle-thumb" />
    </button>
  )
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="s-segmented" role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className={`s-seg-btn pf-seg-btn${value === o.value ? ' active' : ''}`}
          aria-pressed={value === o.value}
          aria-label={o.name}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
