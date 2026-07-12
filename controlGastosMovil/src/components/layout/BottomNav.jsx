import { useApp } from '../../context/AppContext'

const TABS = [
  {
    id: 'year', label: 'Año',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
  },
  {
    id: 'month', label: 'Mes',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  },
  {
    id: 'stats', label: 'Stats',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>,
  },
  {
    id: 'investments', label: 'Cartera',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  },
  {
    id: 'budget', label: 'Presupuesto',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>,
  },
]

export default function BottomNav({ onTabChange }) {
  const { activeTab, setActiveTab } = useApp()

  function handleTab(id) {
    setActiveTab(id)
    onTabChange?.()
  }

  return (
    <nav className="bottom-nav">
      {TABS.map(tab => (
        <button
          key={tab.id}
          className={`nav-btn${activeTab === tab.id ? ' active' : ''}`}
          data-tour={`tab-${tab.id}`}
          onClick={() => handleTab(tab.id)}
          aria-label={tab.label}
        >
          <div className="nav-icon-bg">{tab.icon}</div>
          <span className="nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
