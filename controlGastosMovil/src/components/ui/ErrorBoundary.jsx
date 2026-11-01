import { Component } from 'react'

// Un chunk perezoso que no se puede descargar (típico tras un despliegue: el
// HTML antiguo apunta a un asset con hash que ya no existe) se arregla
// recargando. Se hace una sola vez por minuto para no entrar en un bucle.
const RELOAD_KEY = 'chunk-reload-at'
const RELOAD_WINDOW_MS = 60_000

const CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk .* failed/i,
]

export function isChunkLoadError(err) {
  if (!err) return false
  if (err.name === 'ChunkLoadError') return true
  const msg = String(err.message ?? err)
  return CHUNK_PATTERNS.some(re => re.test(msg))
}

// true si acaba de lanzar la recarga; false si ya se recargó hace poco.
export function reloadOnceForChunkError(now = Date.now()) {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY))
    if (last && now - last < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(now))
  } catch { /* sin sessionStorage: mejor no recargar a ciegas */ return false }
  window.location.reload()
  return true
}

// Evento de Vite cuando falla la precarga de un import() dinámico
export function installPreloadErrorHandler() {
  const handler = (event) => {
    if (reloadOnceForChunkError()) event.preventDefault()
  }
  window.addEventListener('vite:preloadError', handler)
  return () => window.removeEventListener('vite:preloadError', handler)
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, reloading: false }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info?.componentStack)
    if (isChunkLoadError(error) && reloadOnceForChunkError()) {
      this.setState({ reloading: true })
    }
  }
  handleClose = () => {
    this.setState({ error: null, reloading: false })
    this.props.onClose?.()
  }
  render() {
    const { error, reloading } = this.state
    if (!error) return this.props.children
    if (reloading) return null
    const { onClose, variant = 'modal' } = this.props
    const body = (
      <div className="eb-box" role="alert">
        <p className="eb-text">No se ha podido abrir esto. Es posible que haya una versión nueva de la app.</p>
        <div className="eb-actions">
          <button type="button" className="fm-primary" onClick={() => window.location.reload()}>Recargar</button>
          {onClose && <button type="button" className="fm-secondary" onClick={this.handleClose}>Cerrar</button>}
        </div>
      </div>
    )
    if (variant === 'inline') return <div className="eb-inline">{body}</div>
    return (
      <div className="modal-overlay">
        <div className="modal-sheet eb-sheet">{body}</div>
      </div>
    )
  }
}
