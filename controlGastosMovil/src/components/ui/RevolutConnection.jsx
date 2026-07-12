import { useState, useEffect, useCallback } from 'react'
import { usePremium } from '../../hooks/usePremium'
import {
  fetchRevolutConnection, connectRevolut, syncRevolut, disconnectRevolut,
} from '../../services/api'
import PremiumPaywall from './PremiumPaywall'

const REVOLUT_RETURN_PARAM = 'revolut_return'

function statusLabel(status) {
  return {
    disconnected: 'No conectado',
    pending:      'Autorización pendiente…',
    connected:    'Conectado',
  }[status] ?? status
}

export default function RevolutConnection() {
  const { isPremium, loading: loadingPremium } = usePremium()
  const [conn, setConn]         = useState(null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [showPaywall, setShowPaywall] = useState(false)

  const refresh = useCallback(() => {
    if (!isPremium) return
    fetchRevolutConnection().then(setConn).catch(() => {})
  }, [isPremium])

  useEffect(() => { refresh() }, [refresh])

  // Tras volver de autorizar en Revolut, App.jsx confirma+sincroniza y avisa aquí.
  useEffect(() => {
    window.addEventListener('revolut-updated', refresh)
    return () => window.removeEventListener('revolut-updated', refresh)
  }, [refresh])

  async function handleConnect() {
    setBusy(true)
    setError('')
    try {
      const url = new URL(window.location.href)
      url.searchParams.set(REVOLUT_RETURN_PARAM, '1')
      const { link } = await connectRevolut(url.toString())
      window.location.href = link
    } catch (e) {
      setError(e.message || 'No se pudo iniciar la conexión con Revolut')
      setBusy(false)
    }
  }

  async function handleSync() {
    setBusy(true)
    setError('')
    try {
      const { imported } = await syncRevolut()
      await refresh()
      setError(imported > 0 ? '' : '') // sin error; el contador se ve en el toast del padre si hiciera falta
      alert(imported > 0 ? `Se importaron ${imported} movimientos nuevos` : 'No hay movimientos nuevos')
    } catch (e) {
      setError(e.message || 'No se pudo sincronizar')
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

  if (loadingPremium) return null

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
        {status === 'disconnected' && (
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
        {status === 'pending' && (
          <button className="s-action-btn" onClick={handleConnect} disabled={busy}>
            Reintentar
          </button>
        )}
      </div>
      {error && <p className="cat-err" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  )
}

export { REVOLUT_RETURN_PARAM }
