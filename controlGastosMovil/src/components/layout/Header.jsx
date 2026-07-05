import { useFinanceData } from '../../context/FinanceDataContext'
import { useAuth } from '../../context/AuthContext'

export default function Header({ onAvatarClick, pendingCount, onPendingClick, onAddClick }) {
  const { data } = useFinanceData()
  const { user } = useAuth()

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <header className="header">
      <div className="header-title-block">
        <h1 className="header-title">Mi Economía</h1>
        <span className="header-sub">Resumen {data?.year ?? new Date().getFullYear()}</span>
      </div>
      <div className="header-actions">
        {pendingCount > 0 && (
          <button className="pending-btn" onClick={onPendingClick} aria-label="Categorizar pagos pendientes">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span className="pending-badge">{pendingCount}</span>
          </button>
        )}
        <button className="add-tx-btn" onClick={onAddClick} aria-label="Añadir movimiento">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
        <button className="avatar-btn" onClick={onAvatarClick} aria-label="Perfil y ajustes">
          {user?.picture
            ? <img className="avatar-img" src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
            : <span className="avatar-initials">{initials}</span>
          }
        </button>
      </div>
    </header>
  )
}
