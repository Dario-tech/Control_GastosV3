import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'

const BENEFITS = [
  { emoji: '🏦', text: 'Sincroniza tus movimientos de Revolut automáticamente' },
  { emoji: '🔄', text: 'Sin subir extractos a mano: se actualiza solo' },
  { emoji: '🔒', text: 'Conexión segura vía Open Banking — nunca vemos tu contraseña' },
]

export default function PremiumPaywall({ onClose }) {
  useLockBodyScroll()
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-sheet paywall-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <div className="paywall-badge">✨ PREMIUM</div>
        <h2 className="paywall-title">Conecta tu banco automáticamente</h2>
        <ul className="paywall-benefits">
          {BENEFITS.map(b => (
            <li key={b.text} className="paywall-benefit">
              <span className="paywall-benefit-emoji">{b.emoji}</span>
              <span>{b.text}</span>
            </li>
          ))}
        </ul>
        <button className="setup-btn" disabled>
          Hazte Premium — próximamente
        </button>
        <p className="paywall-note">
          Todavía estamos preparando los planes de pago. Mientras tanto, esta función solo
          está disponible para cuentas de prueba internas.
        </p>
        <button className="catmodal-back" style={{ marginTop: 4 }} onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}
