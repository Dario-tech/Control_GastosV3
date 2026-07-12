import { useState, useEffect, useCallback } from 'react'
import { usePremium } from '../../hooks/usePremium'
import {
  fetchRevolutAvailable, fetchRevolutConnection, connectRevolut, syncRevolut, disconnectRevolut,
} from '../../services/api'
import PremiumPaywall from './PremiumPaywall'

const REVOLUT_RETURN_PARAM = 'revolut_return'

// Mensaje único y sencillo ante cualquier fallo: nunca se muestra el detalle
// técnico que pueda venir del backend (nombres de variables, etc.).
const GENERIC_ERROR = 'No se pudo conectar. Inténtalo de nuevo en unos minutos.'

function statusLabel(status) {
  return {
    disconnected: 'Sincroniza tus movimientos automáticamente',
    pending:      'Autorización pendiente…',
    connected:    'Conectado',
  }[status] ?? status
}

export default function RevolutConnection() {
  const { isPremium, loading: loadingPremium } = usePremium()
  const [available, setAvailable] = useState(null) // null = aún no se sabe
  const [conn, setConn]           = useState(null)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(false)
  const [showPaywall, setShowPaywall] = useState(false)

  useEffect(() => {
    fetchRevolutAvailable().then(d => setAvailable(Boolean(d.available))).catch(() => setAvailable(false))
  }, [])

  const refresh = useCallback(() => {
    if (!isPremium || !available) return
    fetchRevolutConnection().then(setConn).catch(() => {})
  }, [isPremium, available])

  useEffect(() => { refresh() }, [refresh])

  // Tras volver de autorizar en Revolut, App.jsx confirma+sincroniza y avisa aquí.
  useEffect(() => {
    window.addEventListener('revolut-updated', refresh)
    return () => window.removeEventListener('revolut-updated', refresh)
  }, [refresh])

  // Un solo toque: la app crea la conexión, redirige a Revolut para autorizar,
  // y al volver confirma y sincroniza sola (ver App.jsx) — el usuario no hace
  // nada más que autorizar en la pantalla de Revolut.
  async function handleConnect() {
    setBusy(true)
    setError(false)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set(REVOLUT_RETURN_PARAM, '1')
      const { link } = await connectRevolut(url.toString())
      window.location.href = link
    } catch {
      setError(true)
      setBusy(false)
    }
  }

  async function handleSync() {
    setBusy(true)
    setError(false)
    try {
      const { imported } = await syncRevolut()
      await refresh()
      alert(imported > 0 ? `Se importaron ${imported} movimientos nuevos` : 'No hay movimientos nuevos')
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('¿Desconectar tu cuenta de Revolut?')) return
    setBusy(true)
    try {
      await disconnectRevolut()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  if (loadingPremium || available === null) return null

  // Sin credenciales configuradas en el backend: nadie ve un botón roto.
  if (!available) {
    return (
      <div className="revolut-card revolut-card--soon">
        <div className="revolut-card-icon">🏦</div>
        <div className="revolut-card-text">
          <div className="revolut-card-title">Conectar con el banco</div>
          <div className="revolut-card-sub">Muy pronto podrás sincronizar tus movimientos automáticamente</div>
        </div>
      </div>
    )
  }

  if (!isPremium) {
    return (
      <>
        <div className="revolut-card revolut-card--locked" onClick={() => setShowPaywall(true)}>
          <div className="revolut-card-icon">🏦</div>
          <div className="revolut-card-text">
            <div className="revolut-card-title">Conectar con Revolut</div>
            <div className="revolut-card-sub">Sincroniza tus movimientos automáticamente</div>
          </div>
          <span className="revolut-lock-badge">✨ PREMIUM</span>
        </div>
        {showPaywall && <PremiumPaywall onClose={() => setShowPaywall(false)} />}
      </>
    )
  }

  const status = conn?.status ?? 'disconnected'

  return (
    <div className="revolut-card">
      <div className="revolut-card-icon">🏦</div>
      <div className="revolut-card-text">
        <div className="revolut-card-title">Revolut</div>
        <div className="revolut-card-sub">{statusLabel(status)}</div>
      </div>
      <div className="revolut-card-actions">
        {status !== 'connected' && (
          <button className="s-action-btn" onClick={handleConnect} disabled={busy}>
            {busy ? '…' : 'Conectar'}
          </button>
        )}
        {status === 'connected' && (
          <>
            <button className="s-action-btn" onClick={handleSync} disabled={busy}>
              {busy ? '…' : 'Sincronizar'}
            </button>
            <button className="s-action-btn danger" onClick={handleDisconnect} disabled={busy}>
              Desconectar
            </button>
          </>
        )}
      </div>
      {error && <p className="cat-err" style={{ marginTop: 6 }}>{GENERIC_ERROR}</p>}
    </div>
  )
}

export { REVOLUT_RETURN_PARAM }
