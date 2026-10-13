import { lazy, Suspense, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../context/AuthContext'
import SettingsTab from '../tabs/SettingsTab'

const ShortcutSetupScreen = lazy(() => import('../ui/ShortcutSetupScreen'))

export default function ProfilePanel({ open, onClose, onShowGuide }) {
  const { user, logout } = useAuth()
  const touchStartX = useRef(null)
  const [setupOpen, setSetupOpen] = useState(false)

  function handleTouchStart(e) {
    // Con la guía del Atajo abierta, el gesto de "deslizar para volver" no
    // debe cerrar el perfil (los eventos de React suben también desde el portal).
    if (setupOpen) { touchStartX.current = null; return }
    touchStartX.current = e.touches[0].clientX
  }
  function handleTouchEnd(e) {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    if (delta > 80) onClose()
    touchStartX.current = null
  }

  function handleLogout() {
    onClose()
    logout()
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div
      className={`profile-screen${open ? ' open' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="profile-topbar">
        <button className="profile-back-btn" onClick={onClose} aria-label="Volver">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <span className="profile-topbar-title">Perfil y ajustes</span>
      </div>

      <div className="profile-user-section">
        <div className="profile-avatar-lg">
          {user?.picture
            ? <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
            : <span>{initials}</span>
          }
        </div>
        <div className="profile-user-info">
          <p className="profile-user-name">{user?.name ?? 'Usuario'}</p>
          <p className="profile-user-email">{user?.email ?? ''}</p>
        </div>
      </div>

      <div className="profile-screen-body">
        <div className="shortcut-token-section">
          <p className="shortcut-token-label">Apple Pay en iPhone</p>
          <button type="button" className="shortcut-setup-btn" onClick={() => setSetupOpen(true)}>
            <span className="shortcut-setup-icon" aria-hidden="true">📲</span>
            <span className="shortcut-setup-text">
              <span className="shortcut-setup-title">Pagos automáticos (iPhone)</span>
              <span className="shortcut-setup-desc">Apunta solos tus pagos con Apple Pay</span>
            </span>
            <span className="shortcut-setup-chev" aria-hidden="true">›</span>
          </button>
        </div>
        <SettingsTab />
        {onShowGuide && (
          <button className="profile-guide-btn" onClick={onShowGuide}>
            📖 Ver guía de la app
          </button>
        )}
        <div className="profile-logout-wrap">
          <button className="profile-logout-btn" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
        <p className="build-marker-inline">build {__BUILD_SHA__} · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}</p>
      </div>
      {/* Portal: .profile-screen tiene transform/contain, que encerrarían el
          position:fixed de la pantalla completa dentro del panel. */}
      {setupOpen && createPortal(
        <Suspense fallback={null}>
          <ShortcutSetupScreen onClose={() => setSetupOpen(false)} />
        </Suspense>,
        document.body,
      )}
    </div>
  )
}
