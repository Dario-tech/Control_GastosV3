import { useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import SettingsTab from '../tabs/SettingsTab'

export default function ProfilePanel({ open, onClose, onShowGuide }) {
  const { user, logout } = useAuth()
  const touchStartX = useRef(null)

  function handleTouchStart(e) {
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

  const [copied, setCopied] = useState(false)

  function copyToken() {
    navigator.clipboard.writeText(user?.shortcut_token ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
        {user?.shortcut_token && (
          <div className="shortcut-token-section">
            <p className="shortcut-token-label">Token para iOS Shortcuts</p>
            <div className="shortcut-token-row">
              <code className="shortcut-token-value">{user.shortcut_token.slice(0, 16)}…</code>
              <button className="shortcut-token-copy" onClick={copyToken}>
                {copied ? '✓ Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        )}
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
      </div>
    </div>
  )
}
