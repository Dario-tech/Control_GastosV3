import { useFinanceData } from '../../context/FinanceDataContext'
import { useAuth } from '../../context/AuthContext'

export default function Header({ onAvatarClick }) {
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
      <button className="avatar-btn" onClick={onAvatarClick} aria-label="Perfil y ajustes">
        {user?.picture
          ? <img className="avatar-img" src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
          : <span className="avatar-initials">{initials}</span>
        }
      </button>
    </header>
  )
}
