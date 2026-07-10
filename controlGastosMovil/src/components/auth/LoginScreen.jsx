import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

export default function LoginScreen() {
  const { loginWithGoogle, registerWithEmail, loginWithEmail } = useAuth()
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  // Formulario email/contraseña
  const [mode, setMode]         = useState('login') // 'login' | 'register'
  const [email, setEmail]       = useState('')
  const [name, setName]         = useState('')
  const [password, setPassword] = useState('')

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

  async function handleEmailSubmit(e) {
    e.preventDefault()
    setError('')

    if (!email.trim() || !password) {
      setError('Introduce tu email y contraseña')
      return
    }
    if (mode === 'register' && password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }

    setLoading(true)
    try {
      if (mode === 'register') {
        await registerWithEmail(email.trim(), name.trim(), password)
      } else {
        await loginWithEmail(email.trim(), password)
      }
    } catch (err) {
      setError(err.message || 'Error de autenticación')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">💶</div>
        <h1 className="login-title">Mi Economía</h1>
        <p className="login-subtitle">Tu control de gastos personal</p>

        {loading ? (
          <div className="login-loading">
            {mode === 'register' ? 'Creando cuenta…' : 'Iniciando sesión…'}
          </div>
        ) : (
          <>
            <form className="login-form" onSubmit={handleEmailSubmit}>
              {mode === 'register' && (
                <input
                  className="login-input"
                  type="text"
                  placeholder="Nombre"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                />
              )}
              <input
                className="login-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
              <input
                className="login-input"
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
              <button className="login-submit" type="submit">
                {mode === 'register' ? 'Crear cuenta' : 'Entrar'}
              </button>
            </form>

            <button
              className="login-switch"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
            >
              {mode === 'login'
                ? '¿No tienes cuenta? Regístrate'
                : '¿Ya tienes cuenta? Inicia sesión'}
            </button>

            {CLIENT_ID && (
              <>
                <div className="login-divider"><span>o</span></div>
                <div id="google-signin-btn" />
              </>
            )}
          </>
        )}

        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  )
}
