import { useFinanceData } from '../../context/FinanceDataContext'
import { useApp } from '../../context/AppContext'

export default function Header() {
  const { showToast } = useApp()
  const { data, status, refresh } = useFinanceData()
  const loading = status === 'loading'

  async function handleSync() {
    await refresh()
    showToast('Datos actualizados ✓')
  }

  return (
    <header className="header">
      <div className="header-title-block">
        <h1 className="header-title">Mi Economía</h1>
        <span className="header-sub">Resumen {data?.year ?? 2025}</span>
      </div>
      <button
        className={`sync-btn ${loading ? 'spinning' : ''}`}
        onClick={handleSync}
        disabled={loading}
        aria-label="Sincronizar"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </button>
    </header>
  )
}
