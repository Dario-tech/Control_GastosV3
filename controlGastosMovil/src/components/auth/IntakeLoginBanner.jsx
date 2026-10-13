import { useEffect, useState } from 'react'
import { captureIntakeFromUrl, loadIntakeQueue } from '../../utils/shortcutIntake'
import { fmt } from '../../utils'

/* Aviso en la pantalla de login cuando el Atajo de iOS ha abierto la app sin
   sesión iniciada: el pago queda guardado en la cola y se envía al entrar. */
export default function IntakeLoginBanner() {
  const [queue, setQueue] = useState(() => {
    captureIntakeFromUrl()
    return loadIntakeQueue()
  })

  useEffect(() => {
    const refresh = () => { captureIntakeFromUrl(); setQueue(loadIntakeQueue()) }
    window.addEventListener('pageshow', refresh)
    window.addEventListener('popstate', refresh)
    return () => {
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('popstate', refresh)
    }
  }, [])

  if (!queue.length) return null
  const last = queue[queue.length - 1]
  const what = `${fmt(last.importe, 2)}${last.comercio ? ` en ${last.comercio}` : ''}`

  return (
    <div className="intake-login-banner" role="status">
      <span aria-hidden="true">💳</span>
      <p>
        {queue.length > 1
          ? <>Tienes <strong>{queue.length} pagos de Apple Pay</strong> esperando (el último, {what}).</>
          : <>Pago de Apple Pay recibido: <strong>{what}</strong>.</>}
        {' '}Inicia sesión para guardarlo.
      </p>
    </div>
  )
}
