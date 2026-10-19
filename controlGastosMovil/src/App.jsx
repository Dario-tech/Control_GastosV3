import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { wakeBackend } from './services/api'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider, useApp } from './context/AppContext'
import { SettingsProvider, useSettings } from './context/SettingsContext'
import { FinanceDataProvider } from './context/FinanceDataContext'
import Header from './components/layout/Header'
import BottomNav from './components/layout/BottomNav'
import ProfilePanel from './components/layout/ProfilePanel'
import Toast from './components/ui/Toast'
import { TabSkeleton, FormSkeleton } from './components/ui/Skeleton'
import { usePendingTransaction } from './hooks/usePendingTransaction'
import { useShortcutIntake } from './hooks/useShortcutIntake'
import LoginScreen from './components/auth/LoginScreen'
import IntakeLoginBanner from './components/auth/IntakeLoginBanner'
import YearTab from './components/tabs/YearTab'

// Año es la pantalla de entrada y va en el bundle inicial. El resto de
// pestañas (con recharts, calendario, formularios…) y los modales grandes se
// descargan bajo demanda.
const importMonthTab  = () => import('./components/tabs/MonthTab')
const importStatsTab  = () => import('./components/tabs/StatsTab')
const importBudgetTab = () => import('./components/tabs/BudgetTab')
const MonthTab  = lazy(importMonthTab)
const StatsTab  = lazy(importStatsTab)
const BudgetTab = lazy(importBudgetTab)
const CategorizeModal      = lazy(() => import('./components/ui/CategorizeModal'))
const AddTransactionModal  = lazy(() => import('./components/ui/AddTransactionModal'))
const SpotlightTour        = lazy(() => import('./components/ui/SpotlightTour'))

// Cuando el navegador está ocioso, baja las demás pestañas para que cambiar
// de una a otra sea instantáneo sin penalizar la carga inicial.
function prefetchTabs() {
  const run = () => { importMonthTab(); importStatsTab(); importBudgetTab() }
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 4000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(run, 2000)
  return () => clearTimeout(id)
}

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
  const { activeTab, showToast } = useApp()
  const { settings, tourSeen, prefsLoaded, syncNotice, syncWarnings } = useSettings()
  const [profileOpen,    setProfileOpen]    = useState(false)
  const [categorizeOpen, setCategorizeOpen] = useState(false)
  const [addOpen,        setAddOpen]        = useState(false)
  const [guideOpen,      setGuideOpen]      = useState(false)
  const { queue, fetchQueue, categorizePending, discardPending } = usePendingTransaction()
  // Pagos de Apple Pay que llegan por URL desde el Atajo de iOS (?atajo=1…)
  const intake = useShortcutIntake({ onChange: fetchQueue })

  const current = queue[0] ?? null

  useEffect(prefetchTabs, [])

  // La guía se enseña una sola vez por usuario: el servidor dice si ya la vio.
  const tourAsked = useRef(false)
  useEffect(() => {
    if (prefsLoaded && !tourSeen && !tourAsked.current) {
      tourAsked.current = true
      setGuideOpen(true)
    }
  }, [prefsLoaded, tourSeen])

  // Avisos de error al guardar cambios en el servidor (con reversión)
  useEffect(() => { if (syncNotice) showToast(syncNotice.msg) }, [syncNotice, showToast])

  return (
    <div className={`app${settings.hideAmounts ? ' hide-amounts' : ''}`}>
      <Header
        onAvatarClick={() => setProfileOpen(true)}
        pendingCount={queue.length}
        onPendingClick={async () => { await fetchQueue(); setCategorizeOpen(true) }}
        onAddClick={() => setAddOpen(true)}
      />
      <main className="main">
        {syncWarnings?.map(msg => (
          <div key={msg} className="sync-warning" role="alert">⚠️ {msg}</div>
        ))}
        <ErrorBoundary>
          <Suspense fallback={<TabSkeleton />}>
            {activeTab === 'year'        && <YearTab />}
            {activeTab === 'month'       && <MonthTab />}
            {activeTab === 'stats'       && <StatsTab />}
            {activeTab === 'budget'      && <BudgetTab />}
          </Suspense>
        </ErrorBoundary>
      </main>
      <BottomNav onTabChange={() => setProfileOpen(false)} />
      <Toast />
      <ProfilePanel
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onShowGuide={() => { setProfileOpen(false); setGuideOpen(true) }}
      />
      <Suspense fallback={null}>
        {guideOpen && (
          <SpotlightTour
            onFinish={() => setGuideOpen(false)}
            modalOpen={addOpen || categorizeOpen}
          />
        )}
      </Suspense>
      <Suspense fallback={<FormSkeleton />}>
        {intake.received && (
          <CategorizeModal
            variant="received"
            pending={intake.received}
            total={1}
            onCategorize={async (...args) => { await categorizePending(...args); intake.dismiss() }}
            onDiscard={async id => { await discardPending(id); intake.dismiss() }}
            onSkip={intake.dismiss}
          />
        )}
        {!intake.received && categorizeOpen && current && (
          <CategorizeModal
            pending={current}
            total={queue.length}
            onCategorize={categorizePending}
            onDiscard={discardPending}
            onSkip={() => setCategorizeOpen(false)}
          />
        )}
        {addOpen && <AddTransactionModal onClose={() => setAddOpen(false)} />}
      </Suspense>
    </div>
  )
}

function AuthGate() {
  const { user } = useAuth()
  // Sin sesión, un pago llegado del Atajo se guarda en la cola (lo captura el
  // banner) y useShortcutIntake lo envía en cuanto se inicia sesión.
  if (!user) return <><IntakeLoginBanner /><LoginScreen /></>
  // key: si cambia la cuenta, se desmonta y vuelve a montar todo el estado en
  // memoria (datos financieros, pendientes...) en vez de reutilizar el anterior.
  return (
    <FinanceDataProvider key={user.email}>
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
