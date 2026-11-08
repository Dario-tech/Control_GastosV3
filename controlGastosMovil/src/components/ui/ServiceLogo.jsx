import { findService } from '../../data/services'

/* Ficha con el logo de un servicio (Netflix, HBO…) sobre el color de su marca. Si no tiene
   logo en el paquete, o el nombre no es un servicio conocido, muestra su inicial. */
export default function ServiceLogo({ nombre, size = 36 }) {
  const svc = findService(nombre)
  const label = svc?.nombre || nombre || '?'
  const bg = svc ? (svc.color || (svc.icon ? `#${svc.icon.hex}` : '#475569')) : '#475569'
  const style = { width: size, height: size, background: bg, borderRadius: Math.round(size * 0.28) }
  return (
    <span className="svc-logo" style={style} role="img" aria-label={label}>
      {svc?.icon ? (
        <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="#fff" aria-hidden="true"><path d={svc.icon.path} /></svg>
      ) : (
        <span className="svc-logo-letter" style={{ fontSize: size * 0.45 }} aria-hidden="true">{label.trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}
