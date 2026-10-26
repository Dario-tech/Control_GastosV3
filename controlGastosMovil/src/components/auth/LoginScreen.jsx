import { useEffect, useState } from 'react'
import { useAuth, REGISTRO_CERRADO } from '../../context/AuthContext'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

export default function LoginScreen() {
  const { loginWithGoogle, registerWithEmail, loginWithEmail, sessionExpiredMsg, clearSessionExpiredMsg } = useAuth()
  const [error, setError]     = useState(sessionExpiredMsg || '')
  const [loading, setLoading] = useState(false)
  // El servidor ha dicho que el alta está cerrada: se atenúa «Regístrate»
  const [registroCerrado, setRegistroCerrado] = useState(false)
  const noteClosed = msg => { if (msg === REGISTRO_CERRADO) setRegistroCerrado(true) }

  // Si nos han traído aquí por una sesión caducada, mostramos ese aviso una
  // vez y limpiamos el flag para que no reaparezca en el siguiente login.
  useEffect(() => {
    if (sessionExpiredMsg) {
      setError(sessionExpiredMsg)
      clearSessionExpiredMsg()
    }
  }, [sessionExpiredMsg, clearSessionExpiredMsg])

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
            noteClosed(e.message)
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
    if (mode === 'register' && password.length < 10) {
      setError('La contraseña debe tener al menos 10 caracteres')
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
      if (mode === 'register') noteClosed(err.message)
      if (err.message === REGISTRO_CERRADO) setMode('login')
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
                  aria-label="Nombre"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                />
              )}
              <input
                className="login-input"
                type="email"
                placeholder="Email"
                  aria-label="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
              <input
                className="login-input"
                type="password"
                placeholder={mode === 'register' ? 'Contraseña (mínimo 10 caracteres)' : 'Contraseña'}
                aria-label="Contraseña"
                minLength={mode === 'register' ? 10 : undefined}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
              <button className="login-submit" type="submit">
                {mode === 'register' ? 'Crear cuenta' : 'Entrar'}
              </button>
            </form>

            {registroCerrado ? (
              <p className="login-switch" role="note" style={{ opacity: 0.7 }}>
                El registro está cerrado. Pídele acceso al administrador.
              </p>
            ) : (
              <button
                className="login-switch"
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
              >
                {mode === 'login'
                  ? '¿No tienes cuenta? Regístrate'
                  : '¿Ya tienes cuenta? Inicia sesión'}
              </button>
            )}

            {CLIENT_ID && (
              <>
                <div className="login-divider"><span>o</span></div>
                <div id="google-signin-btn" />
              </>
            )}
          </>
        )}

        {error && <p className="login-error" role="alert">{error}</p>}
      </div>
      <p className="build-marker">build {__BUILD_SHA__}</p>
    </div>
  )
}
