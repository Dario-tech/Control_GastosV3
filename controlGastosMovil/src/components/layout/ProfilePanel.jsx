import { useAuth } from '../../context/AuthContext'
import SettingsTab from '../tabs/SettingsTab'

export default function ProfilePanel({ open, onClose }) {
  const { user, logout } = useAuth()

  function handleLogout() {
    onClose()
    logout()
  }

  return (
    <>
      <div
        className={`profile-overlay${open ? ' visible' : ''}`}
        onClick={onClose}
      />
      <div className={`profile-panel${open ? ' open' : ''}`}>
        <div className="profile-panel-drag" />

        <div className="profile-user-section">
          <div className="profile-avatar-lg">
            {user?.picture
              ? <img src={user.picture} alt={user?.name} referrerPolicy="no-referrer" />
              : <span>{user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'}</span>
            }
          </div>
          <div className="profile-user-info">
            <p className="profile-user-name">{user?.name ?? 'Usuario'}</p>
            <p className="profile-user-email">{user?.email ?? ''}</p>
          </div>
        </div>

        <div className="profile-panel-body">
          <SettingsTab />
        </div>

        <div className="profile-logout-wrap">
          <button className="profile-logout-btn" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </>
  )
}
