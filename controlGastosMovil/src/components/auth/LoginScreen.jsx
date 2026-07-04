import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

export default function LoginScreen() {
  const { loginWithGoogle } = useAuth()
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!CLIENT_ID) return
    const interval = setInterval(() => {
      if (!window.google?.accounts?.id) return
      clearInterval(interval)
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback:  async ({ credential }) => {
          setError('')
          setLoading(true)
          try {
            await loginWithGoogle(credential)
          } catch (e) {
            setError(e.message || 'Error al iniciar sesión')
          } finally {
            setLoading(false)
          }
        },
      })
      window.google.accounts.id.renderButton(
        document.getElementById('google-signin-btn'),
        { theme: 'outline', size: 'large', text: 'continue_with', locale: 'es', width: 280 }
      )
    }, 100)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">💶</div>
        <h1 className="login-title">Mi Economía</h1>
        <p className="login-subtitle">Tu control de gastos personal</p>

        {loading ? (
          <div className="login-loading">Iniciando sesión…</div>
        ) : (
          <div id="google-signin-btn" />
        )}

        {error && <p className="login-error">{error}</p>}

        {!CLIENT_ID && (
          <p className="login-error">VITE_GOOGLE_CLIENT_ID no configurado</p>
        )}
      </div>
    </div>
  )
}
