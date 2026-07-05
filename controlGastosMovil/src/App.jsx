import { Component, useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider, useApp } from './context/AppContext'
import { SettingsProvider, useSettings } from './context/SettingsContext'
import { FinanceDataProvider } from './context/FinanceDataContext'
import Header from './components/layout/Header'
import BottomNav from './components/layout/BottomNav'
import ProfilePanel from './components/layout/ProfilePanel'
import CategorizeModal from './components/ui/CategorizeModal'
import AddTransactionModal from './components/ui/AddTransactionModal'
import Toast from './components/ui/Toast'
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
  const [profileOpen,    setProfileOpen]    = useState(false)
  const [categorizeOpen, setCategorizeOpen] = useState(false)
  const [addOpen,        setAddOpen]        = useState(false)
  const { queue, fetchQueue, categorizePending } = usePendingTransaction()

  const current = queue[0] ?? null


  return (
    <div className={`app${settings.hideAmounts ? ' hide-amounts' : ''}`}>
      <Header
        onAvatarClick={() => setProfileOpen(true)}
        pendingCount={queue.length}
        onPendingClick={async () => { await fetchQueue(); setCategorizeOpen(true) }}
        onAddClick={() => setAddOpen(true)}
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
      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
      {categorizeOpen && current && (
        <CategorizeModal
          pending={current}
          total={queue.length}
          onCategorize={categorizePending}
          onSkip={() => setCategorizeOpen(false)}
        />
      )}
      {addOpen && <AddTransactionModal onClose={() => setAddOpen(false)} />}
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
  return (
    <AuthProvider>
      <SettingsProvider>
        <AuthGate />
      </SettingsProvider>
    </AuthProvider>
  )
}
