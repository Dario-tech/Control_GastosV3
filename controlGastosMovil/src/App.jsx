import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { wakeBackend } from './services/api'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider, useApp } from './context/AppContext'
import { SettingsProvider, useSettings } from './context/SettingsContext'
import { FinanceDataProvider, useFinanceData, unreadableTxMsg } from './context/FinanceDataContext'
import Header from './components/layout/Header'
import BottomNav from './components/layout/BottomNav'
import ProfilePanel from './components/layout/ProfilePanel'
import ErrorBoundary, { installPreloadErrorHandler } from './components/ui/ErrorBoundary'
import Toast from './components/ui/Toast'
import { TabSkeleton, FormSkeleton } from './components/ui/Skeleton'
import { usePendingTransaction } from './hooks/usePendingTransaction'
import { useShortcutIntake } from './hooks/useShortcutIntake'
import { useTxQueue } from './hooks/useTxQueue'
import { useThemeColorMeta } from './hooks/useThemeColorMeta'
import { useViewportInsets } from './hooks/useViewportInsets'
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
const TransactionSearchModal = lazy(() => import('./components/ui/TransactionSearchModal'))
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

function AppContent() {
  const { activeTab, showToast } = useApp()
  const { settings, tourSeen, prefsLoaded, syncNotice, syncWarnings } = useSettings()
  const finance = useFinanceData()
  const txWarning = unreadableTxMsg(finance?.unreadableTx)
  const [profileOpen,    setProfileOpen]    = useState(false)
  const [categorizeOpen, setCategorizeOpen] = useState(false)
  const [addOpen,        setAddOpen]        = useState(false)
  const [searchOpen,     setSearchOpen]     = useState(false)
  const [guideOpen,      setGuideOpen]      = useState(false)
  const { queue, fetchQueue, categorizePending, discardPending } = usePendingTransaction()
  // Pagos de Apple Pay que llegan por URL desde el Atajo de iOS (?atajo=1…)
  const intake = useShortcutIntake({ onChange: fetchQueue })
  // Movimientos guardados sin conexión: se reenvían al volver la red
  useTxQueue({ onChange: finance?.refresh })

  const current = queue[0] ?? null

  useEffect(prefetchTabs, [])
  useEffect(installPreloadErrorHandler, [])

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

  // La clase también va en <html>: los modales y hojas que se montan en
  // document.body (portales) quedan fuera de .app y también deben difuminarse.
  useEffect(() => {
    document.documentElement.classList.toggle('hide-amounts', !!settings.hideAmounts)
    return () => document.documentElement.classList.remove('hide-amounts')
  }, [settings.hideAmounts])

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
        {syncWarnings?.map(msg => (
          <div key={msg} className="sync-warning" role="alert">⚠️ {msg}</div>
        ))}
        {txWarning && <div className="sync-warning" role="alert">⚠️ {txWarning}</div>}
        {/* key con la moneda: al cambiarla se repintan las pantallas con el nuevo símbolo */}
        <ErrorBoundary key={`${activeTab}-${settings.currency}`} variant="inline">
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
      <ErrorBoundary onClose={() => setProfileOpen(false)}>
        <ProfilePanel
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          onShowGuide={() => { setProfileOpen(false); setGuideOpen(true) }}
        />
      </ErrorBoundary>
      <ErrorBoundary onClose={() => setGuideOpen(false)}>
        <Suspense fallback={null}>
          {guideOpen && (
            <SpotlightTour
              onFinish={() => setGuideOpen(false)}
              modalOpen={addOpen || categorizeOpen}
            />
          )}
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary onClose={intake.dismiss}>
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
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary onClose={() => setCategorizeOpen(false)}>
        <Suspense fallback={<FormSkeleton />}>
          {!intake.received && categorizeOpen && current && (
            <CategorizeModal
              pending={current}
              total={queue.length}
              onCategorize={categorizePending}
              onDiscard={discardPending}
              onSkip={() => setCategorizeOpen(false)}
            />
          )}
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary onClose={() => setSearchOpen(false)}>
        <Suspense fallback={<FormSkeleton />}>
          {searchOpen && <TransactionSearchModal onClose={() => setSearchOpen(false)} />}
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary onClose={() => setAddOpen(false)}>
        <Suspense fallback={<FormSkeleton />}>
          {addOpen && <AddTransactionModal onClose={() => setAddOpen(false)} />}
        </Suspense>
      </ErrorBoundary>
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
  // Zonas seguras: theme-color según el tema y altura del teclado virtual
  useThemeColorMeta()
  useViewportInsets()

  return (
    <AuthProvider>
      <SettingsProvider>
        <AuthGate />
      </SettingsProvider>
    </AuthProvider>
  )
}
