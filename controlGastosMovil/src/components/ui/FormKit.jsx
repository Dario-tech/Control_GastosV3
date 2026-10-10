import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/* Conjunto único de piezas de formulario (clases `fm-*` en App.css) para las
   pantallas que se abren desde Planificación: presupuesto, meta de ahorro,
   gasto fijo y detalle de meta. Solo presentación: ninguna toca datos ni API. */

const ICONS = {
  back:   <path d="M15 18l-6-6 6-6" />,
  close:  <path d="M6 6l12 12M18 6L6 18" />,
  check:  <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert:  <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.4v.1" /></>,
  pencil: <path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3zM14.5 7.5l3 3" />,
  camera: <><path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-9z" /><circle cx="12" cy="13" r="3.4" /></>,
  trash:  <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" />,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="3" /><path d="M8 3.5v4M16 3.5v4M4 10h16" /></>,
  users:  <><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.5-3 2.6-4.6 5.5-4.6s5 1.6 5.5 4.6M16 6.2a3 3 0 010 5.6M17.5 14.6c1.8.5 3 1.9 3.3 4.4" /></>,
}

export function Icon({ name, size = 20, className = '' }) {
  return (
    <svg className={`fm-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

/* Pantalla completa de cristal: barra con atrás, título grande, cuerpo con
   scroll y pie fijo para la acción principal (respeta la safe-area). */
export function FormScreen({ title, subtitle, onClose, headerRight, footer, error, children, label }) {
  const ref = useRef(null)
  const [scrolled, setScrolled] = useState(false)

  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true })
    const onKey = e => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fm-screen" role="dialog" aria-modal="true" aria-label={label || title} ref={ref} tabIndex={-1}>
      <header className={`fm-header${scrolled ? ' scrolled' : ''}`}>
        <button type="button" className="fm-icon-btn" onClick={onClose} aria-label="Volver">
          <Icon name="back" />
        </button>
        <span className="fm-header-title" aria-hidden="true">{title}</span>
        <div className="fm-header-right">{headerRight}</div>
      </header>
      <div className="fm-body" onScroll={e => setScrolled(e.currentTarget.scrollTop > 36)}>
        <div className="fm-heading">
          <h1 className="fm-title">{title}</h1>
          {subtitle && <p className="fm-subtitle">{subtitle}</p>}
        </div>
        {children}
      </div>
      {(footer || error) && (
        <div className="fm-footer">
          {error && <p className="fm-error fm-footer-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
          {footer}
        </div>
      )}
    </div>
  )
}

/* Campo con etiqueta, ayuda y error inline (icono + texto, no solo color).
   `children` puede ser una función ({ id, describedBy, invalid }). */
export function Field({ label, optional, hint, error, children, className = '' }) {
  const id = useId()
  const msgId = `${id}-msg`
  const describedBy = (error || hint) ? msgId : undefined
  return (
    <div className={`fm-field ${className}`}>
      {label && (
        <label className="fm-label" htmlFor={id}>
          <span>{label}</span>
          {optional && <span className="fm-optional">Opcional</span>}
        </label>
      )}
      {typeof children === 'function' ? children({ id, describedBy, invalid: !!error }) : children}
      {error
        ? <p className="fm-error" id={msgId} role="alert"><Icon name="alert" size={15} />{error}</p>
        : hint && <p className="fm-hint" id={msgId}>{hint}</p>}
    </div>
  )
}

/* Sección con título pequeño (agrupa varios controles sin un único input). */
export function Section({ title, aside, children }) {
  return (
    <section className="fm-section">
      {(title || aside) && (
        <div className="fm-section-head">
          <h2 className="fm-section-title">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

/* Importe protagonista: grande, centrado, cifras tabulares, teclado decimal. */
export function AmountInput({ value, onChange, onBlur, id, describedBy, invalid, placeholder = '0', size = 'lg', autoFocus, suffix = '€', ariaLabel, onEnter }) {
  function handle(e) {
    // Solo dígitos y un separador decimal (coma o punto).
    let v = e.target.value.replace(/[^\d.,]/g, '')
    const first = v.search(/[.,]/)
    if (first !== -1) v = v.slice(0, first + 1) + v.slice(first + 1).replace(/[.,]/g, '')
    onChange(v)
  }
  const chars = Math.max(1, (value || '').length || placeholder.length)
  return (
    <div className={`fm-amount fm-amount--${size}${invalid ? ' invalid' : ''}`}>
      <input
        id={id}
        autoFocus={autoFocus}
        className="fm-amount-input"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        placeholder={placeholder}
        value={value}
        onChange={handle}
        onBlur={onBlur}
        onKeyDown={onEnter ? (e => e.key === 'Enter' && onEnter()) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        style={{ width: `${chars + 0.6}ch` }}
      />
      <span className="fm-amount-cur" aria-hidden="true">{suffix}</span>
    </div>
  )
}

/* Chips de atajo (importes, fechas, periodicidad…). */
export function Chips({ options, isActive, onPick, label, align = 'center' }) {
  return (
    <div className={`fm-chips fm-chips--${align}`} role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o.key ?? o.label}
          type="button"
          className="fm-chip"
          aria-pressed={isActive ? !!isActive(o) : undefined}
          onClick={() => onPick(o)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* Control segmentado de cristal con pastilla deslizante. */
export function Segmented({ options, value, onChange, label }) {
  const idx = Math.max(0, options.findIndex(o => o.id === value))
  return (
    <div className="fm-seg" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': idx }}>
      <span className="fm-seg-thumb" aria-hidden="true" />
      {options.map(o => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className="fm-seg-btn"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* Cuadrícula de teselas con icono grande; la seleccionada lleva borde de
   acento + check (no depende solo del color). */
export function TileGrid({ items, isSelected, onSelect, columns = 3, label }) {
  return (
    <div className={`fm-grid fm-grid--${columns}`} role="radiogroup" aria-label={label}>
      {items.map(it => {
        const sel = isSelected(it)
        return (
          <button
            key={it.key}
            type="button"
            role="radio"
            aria-checked={sel}
            aria-label={it.ariaLabel}
            className={`fm-tile${sel ? ' selected' : ''}`}
            onClick={() => onSelect(it)}
          >
            <span className="fm-tile-icon">{it.icon}</span>
            {it.label && <span className="fm-tile-label">{it.label}</span>}
            {sel && <span className="fm-tile-check"><Icon name="check" size={13} /></span>}
          </button>
        )
      })}
    </div>
  )
}

/* Interruptor accesible (fila con texto + switch). */
export function SwitchRow({ checked, onChange, title, desc }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="fm-switch-row" onClick={() => onChange(!checked)}>
      <span className="fm-switch-text">
        <span className="fm-switch-title">{title}</span>
        {desc && <span className="fm-switch-desc">{desc}</span>}
      </span>
      <span className="fm-switch" aria-hidden="true"><span className="fm-switch-thumb" /></span>
    </button>
  )
}

/* Botón principal fijo en el pie: degradado, estado de carga y deshabilitado. */
export function PrimaryButton({ children, loading, disabled, onClick, type = 'button', hint }) {
  return (
    <>
      {disabled && !loading && hint && <p className="fm-footer-hint">{hint}</p>}
      <button
        type={type}
        className={`fm-primary${loading ? ' loading' : ''}`}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        onClick={onClick}
      >
        {loading && <span className="fm-spinner" aria-hidden="true" />}
        <span>{children}</span>
      </button>
    </>
  )
}

export function DangerButton({ children, onClick, disabled }) {
  return (
    <button type="button" className="fm-danger" onClick={onClick} disabled={disabled}>
      <Icon name="trash" size={18} />{children}
    </button>
  )
}

/* Hoja inferior de cristal para acciones secundarias (compartir, confirmar). */
export function Sheet({ title, onClose, children, label }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return createPortal(
    <div className="fm-sheet-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="fm-sheet" role="dialog" aria-modal="true" aria-label={label || title} ref={ref} tabIndex={-1}>
        <div className="fm-sheet-grab" aria-hidden="true" />
        {title && <h2 className="fm-sheet-title">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  )
}

/* Confirmación propia (sustituye a window.confirm). `onConfirm` puede ser async. */
export function ConfirmSheet({ title, message, confirmLabel = 'Eliminar', danger = true, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  return (
    <Sheet title={title} onClose={busy ? () => {} : onCancel}>
      {message && <p className="fm-sheet-msg">{message}</p>}
      <div className="fm-sheet-actions">
        <button type="button" className="fm-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="button" className={`fm-confirm${danger ? ' danger' : ''}`} onClick={go} disabled={busy} aria-busy={busy || undefined}>
          {busy && <span className="fm-spinner" aria-hidden="true" />}
          <span>{confirmLabel}</span>
        </button>
      </div>
    </Sheet>
  )
}
