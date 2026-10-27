import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../context/AuthContext'
import SettingsTab, { SCREENS } from '../tabs/SettingsTab'
import { ConfirmSheet } from '../ui/FormKit'

const ShortcutSetupScreen = lazy(() => import('../ui/ShortcutSetupScreen'))

// Pantallas a pantalla completa o hojas abiertas encima del panel (portales).
const OVERLAYS = '.fm-screen, .fm-sheet-overlay'
// Elementos del fondo que no se vuelven inertes: el aviso (toast) es solo informativo.
// El panel cubre también la barra inferior, que sí queda inerte.
const KEEP_ACTIVE = '.toast'

export default function ProfilePanel({ open, onClose, onShowGuide }) {
  const { user, logout } = useAuth()
  const touchStart = useRef(null)
  const panelRef = useRef(null)
  const titleRef = useRef(null)
  const prevScreen = useRef('home')
  const [screen, setScreen] = useState('home')
  const [setupOpen, setSetupOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)

  const atHome = screen === 'home'
  const goBack = () => (atHome ? onClose() : setScreen('home'))
  const goBackRef = useRef(goBack)
  goBackRef.current = goBack

  // Al abrir: el fondo queda inerte (ni foco ni lector de pantalla) y el foco pasa al
  // título del panel; al cerrar se devuelve el fondo a la normalidad y el foco a quien
  // abrió el panel.
  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const siblings = [...(panel?.parentElement?.children ?? [])]
      .filter(el => el !== panel && !el.matches(KEEP_ACTIVE) && !el.hasAttribute('inert'))
    siblings.forEach(el => el.setAttribute('inert', ''))
    const t = setTimeout(() => titleRef.current?.focus({ preventScroll: true }), 50)
    return () => {
      clearTimeout(t)
      siblings.forEach(el => el.removeAttribute('inert'))
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [open])

  // Al cerrar, la siguiente apertura empieza en la pantalla principal (tras la animación).
  useEffect(() => {
    if (open) return undefined
    const t = setTimeout(() => setScreen('home'), 500)
    return () => clearTimeout(t)
  }, [open])

  // Foco al cambiar de pantalla: al título de la subpantalla, o de vuelta a la fila que la abrió.
  useEffect(() => {
    const prev = prevScreen.current
    prevScreen.current = screen
    if (!open || prev === screen) return
    if (screen === 'home') {
      const row = panelRef.current?.querySelector(`[data-pf-row="${prev}"]`)
      if (row) { row.focus({ preventScroll: true }); return }
    }
    titleRef.current?.focus({ preventScroll: true })
  }, [screen, open])

  // Escape: vuelve a la pantalla principal o cierra (si no hay otra pantalla/hoja encima).
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector(OVERLAYS)) return
      goBackRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function handleTouchStart(e) {
    // Con una pantalla encima (guía del Atajo, nueva categoría, confirmación) o sobre
    // el deslizador, el gesto de "deslizar para volver" no debe actuar.
    if (setupOpen || logoutOpen || document.querySelector(OVERLAYS) || e.target.closest?.('input[type="range"]')) {
      touchStart.current = null; return
    }
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  function handleTouchEnd(e) {
    const s = touchStart.current
    touchStart.current = null
    if (!s) return
    const dx = e.changedTouches[0].clientX - s.x
    const dy = Math.abs(e.changedTouches[0].clientY - s.y)
    if (dx > 80 && dy < 60) goBack()
  }

  function handleLogout() {
    setLogoutOpen(false)
    onClose()
    logout()
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'
  const title = SCREENS[screen]?.title ?? SCREENS.home.title

  return (
    <div
      ref={panelRef}
      className={`profile-screen${open ? ' open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Perfil y ajustes"
      aria-hidden={open ? undefined : true}
      inert={open ? undefined : ''}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="profile-topbar">
        <button
          type="button"
          className="profile-back-btn"
          onClick={goBack}
          aria-label={atHome ? 'Cerrar perfil y ajustes' : 'Volver a Perfil y ajustes'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="profile-topbar-title" ref={titleRef} tabIndex={-1}>{title}</h1>
      </div>

      <div className="profile-screen-body pf-body" key={screen}>
        {atHome && (
          <div className="pf-account">
            <div className="profile-avatar-lg">
              {user?.picture
                ? <img src={user.picture} alt="" referrerPolicy="no-referrer" />
                : <span aria-hidden="true">{initials}</span>
              }
            </div>
            <div className="profile-user-info">
              <p className="profile-user-name">{user?.name ?? 'Usuario'}</p>
              <p className="profile-user-email">{user?.email ?? ''}</p>
            </div>
          </div>
        )}
        <SettingsTab
          screen={screen}
          onNavigate={setScreen}
          onOpenShortcut={() => setSetupOpen(true)}
          onShowGuide={onShowGuide}
          onLogout={() => setLogoutOpen(true)}
        />
      </div>

      {logoutOpen && (
        <ConfirmSheet
          title="¿Cerrar sesión?"
          message="Tendrás que volver a iniciar sesión para ver tus datos."
          confirmLabel="Cerrar sesión"
          onConfirm={handleLogout}
          onCancel={() => setLogoutOpen(false)}
        />
      )}
      {/* Portal: .profile-screen tiene transform/contain, que encerrarían el
          position:fixed de la pantalla completa dentro del panel. */}
      {setupOpen && createPortal(
        <Suspense fallback={null}>
          <ShortcutSetupScreen onClose={() => setSetupOpen(false)} />
        </Suspense>,
        document.body,
      )}
    </div>
  )
}
