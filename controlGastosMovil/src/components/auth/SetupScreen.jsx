import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

export default function SetupScreen() {
  const { user, registerSheet, logout } = useAuth()
  const [url, setUrl]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!url.includes('script.google.com')) {
      setError('Pega la URL del Apps Script de tu Google Sheet')
      return
    }
    setLoading(true)
    try {
      await registerSheet(url.trim())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card" style={{ maxWidth: 400 }}>
        <div className="login-logo">⚙️</div>
        <h1 className="login-title">Configuración inicial</h1>
        <p className="login-subtitle">
          Hola <strong>{user?.name || user?.email}</strong>, necesitas conectar tu Google Sheet
          para empezar a usar la app.
        </p>

        <div className="setup-steps">
          <p className="setup-step">1. Abre tu Google Sheet de gastos</p>
          <p className="setup-step">2. Ve a <strong>Extensiones → Apps Script</strong></p>
          <p className="setup-step">3. Despliega como aplicación web</p>
          <p className="setup-step">4. Copia y pega la URL aquí abajo</p>
        </div>

        <form onSubmit={handleSubmit} className="setup-form">
          <input
            className="setup-input"
            type="url"
            placeholder="https://script.google.com/macros/s/..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            required
          />
          <button className="setup-btn" type="submit" disabled={loading}>
            {loading ? 'Guardando…' : 'Conectar Sheet'}
          </button>
        </form>

        {error && <p className="login-error">{error}</p>}

        <button className="setup-logout" onClick={logout}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
