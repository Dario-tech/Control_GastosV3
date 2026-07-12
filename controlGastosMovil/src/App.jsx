import { Component, useEffect, useState } from 'react'
import { wakeBackend } from './services/api'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider, useApp } from './context/AppContext'
import { SettingsProvider, useSettings } from './context/SettingsContext'
import { FinanceDataProvider } from './context/FinanceDataContext'
import Header from './components/layout/Header'
import BottomNav from './components/layout/BottomNav'
import ProfilePanel from './components/layout/ProfilePanel'
import CategorizeModal from './components/ui/CategorizeModal'
import AddTransactionModal from './components/ui/AddTransactionModal'
import TransactionSearchModal from './components/ui/TransactionSearchModal'
import Toast from './components/ui/Toast'
import SpotlightTour, { shouldShowTour } from './components/ui/SpotlightTour'
import { REVOLUT_RETURN_PARAM } from './components/ui/RevolutConnection'
import { confirmRevolutConnection, syncRevolut } from './services/api'
import { usePendingTransaction } from './hooks/usePendingTransaction'
import LoginScreen from './components/auth/LoginScreen'
import YearTab from './components/tabs/YearTab'
import MonthTab from './components/tabs/MonthTab'
import StatsTab from './components/tabs/StatsTab'
import InvestmentsTab from './components/tabs/InvestmentsTab'
import BudgetTab from './components/tabs/BudgetTab'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, background: '#1e2435', color: '#ff5f7e', fontFamily: 'monospace', fontSize: 13, minHeight: '100vh' }}>
          <h2 style={{ color: '#ff5f7e', marginBottom: 12 }}>Error de renderizado</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#0f1117', padding: 16, borderRadius: 8 }}>
            {this.state.error.message}{'\n\n'}{this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

function AppContent() {
  const { activeTab } = useApp()
  const { settings }  = useSettings()
  const { showToast } = useApp()
  const [profileOpen,    setProfileOpen]    = useState(false)
  const [categorizeOpen, setCategorizeOpen] = useState(false)
  const [addOpen,        setAddOpen]        = useState(false)
  const [searchOpen,     setSearchOpen]     = useState(false)
  const [guideOpen,      setGuideOpen]      = useState(shouldShowTour)
  const { queue, fetchQueue, categorizePending } = usePendingTransaction()

  const current = queue[0] ?? null

  // Vuelta de autorizar Revolut en GoCardless: confirma la conexión, importa
  // los movimientos y limpia el parámetro de la URL.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(REVOLUT_RETURN_PARAM)) return
    url.searchParams.delete(REVOLUT_RETURN_PARAM)
    window.history.replaceState({}, '', url.toString())
    setProfileOpen(true)
    confirmRevolutConnection()
      .then(({ status }) => {
        if (status !== 'connected') {
          showToast('⚠️ No se pudo confirmar la conexión con Revolut')
          return
        }
        return syncRevolut().then(({ imported }) => {
          showToast(imported > 0 ? `🏦 Revolut conectado: ${imported} movimientos importados` : '🏦 Revolut conectado')
        })
      })
      .catch(() => showToast('⚠️ No se pudo conectar con Revolut'))
      .finally(() => window.dispatchEvent(new Event('revolut-updated')))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <div className={`app${settings.hideAmounts ? ' hide-amounts' : ''}`}>
      <Header
        onAvatarClick={() => setProfileOpen(true)}
        pendingCount={queue.length}
        onPendingClick={async () => { await fetchQueue(); setCategorizeOpen(true) }}
        onAddClick={() => setAddOpen(true)}
        onSearchClick={() => setSearchOpen(true)}
      />
      <main className="main">
        <ErrorBoundary>
          {activeTab === 'year'        && <YearTab />}
          {activeTab === 'month'       && <MonthTab />}
          {activeTab === 'stats'       && <StatsTab />}
          {activeTab === 'investments' && <InvestmentsTab />}
          {activeTab === 'budget'      && <BudgetTab />}
        </ErrorBoundary>
      </main>
      <BottomNav onTabChange={() => setProfileOpen(false)} />
      <Toast />
      <ProfilePanel
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onShowGuide={() => { setProfileOpen(false); setGuideOpen(true) }}
      />
      {guideOpen && (
        <SpotlightTour
          onFinish={() => setGuideOpen(false)}
          modalOpen={addOpen || searchOpen || categorizeOpen}
        />
      )}
      {categorizeOpen && current && (
        <CategorizeModal
          pending={current}
          total={queue.length}
          onCategorize={categorizePending}
          onSkip={() => setCategorizeOpen(false)}
        />
      )}
      {addOpen && <AddTransactionModal onClose={() => setAddOpen(false)} />}
      {searchOpen && <TransactionSearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  )
}

function AuthGate() {
  const { user } = useAuth()
  if (!user) return <LoginScreen />
  return (
    <FinanceDataProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </FinanceDataProvider>
  )
}

export default function App() {
  // Despierta el backend en segundo plano en cuanto se abre la app, antes de
  // que el usuario intente guardar algo (Render free tier duerme el servicio).
  useEffect(() => { wakeBackend() }, [])

  return (
    <AuthProvider>
      <SettingsProvider>
        <AuthGate />
      </SettingsProvider>
    </AuthProvider>
  )
}
