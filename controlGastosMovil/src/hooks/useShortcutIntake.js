import { useCallback, useEffect, useState } from 'react'
import { createPending } from '../services/api'
import { todayLocal } from '../utils'
import { useApp } from '../context/AppContext'
import {
  captureIntakeFromUrl, loadIntakeQueue, enqueueIntake, removeIntake, isRetryableError,
} from '../utils/shortcutIntake'

// Cerrojo a nivel de módulo: StrictMode monta los efectos dos veces y los
// eventos (visibilidad, online, pageshow) pueden llegar casi a la vez; así
// nunca hay dos envíos de la cola en paralelo.
let processing = false

/* Recibe los pagos de Apple Pay que llegan por URL desde el Atajo de iOS
   (?atajo=1&importe=…&comercio=…), los envía como pendientes y abre la hoja
   "Gasto recibido". Montado solo con sesión iniciada; sin sesión, AuthGate ya
   los deja en la cola y se envían aquí nada más entrar. */
export function useShortcutIntake({ onChange } = {}) {
  const { showToast } = useApp()
  const [received, setReceived] = useState(null)

  const process = useCallback(async () => {
    const captured = captureIntakeFromUrl()
    if (captured?.error) showToast('No se entendió el importe del pago. Añádelo a mano.')
    if (processing) return
    processing = true
    let offline = false
    try {
      for (const item of loadIntakeQueue()) {
        try {
          const res = await createPending(item)
          removeIntake(item.id_externo)
          onChange?.()
          // "duplicada" (mismo id_externo o mismo importe+comercio hace poco):
          // el backend devuelve el pendiente que ya existía; se abre igual.
          setReceived({
            id:        res.id,
            importe:   res.importe ?? item.importe,
            comercio:  res.comercio ?? item.comercio,
            fecha:     String(res.fecha ?? item.fecha ?? todayLocal()).slice(0, 10),
            suggested: res.sugerencia ?? null,
            fuente:    'wallet',
          })
        } catch (e) {
          if (isRetryableError(e)) {
            // Se vuelve a guardar: si era un 401, la limpieza de sesión acaba
            // de borrar la cola y el pago se enviará tras volver a entrar.
            enqueueIntake(item)
            offline = true
            break
          }
          removeIntake(item.id_externo)
          showToast('No se pudo registrar el pago. Añádelo a mano.')
        }
      }
    } finally {
      processing = false
    }
    // Solo se avisa cuando el pago acaba de llegar, no en cada reintento.
    if (offline && captured?.item) showToast('Guardado, se enviará en cuanto haya conexión')
  }, [showToast, onChange])

  useEffect(() => {
    process()
    const onVisible = () => { if (document.visibilityState === 'visible') process() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', process)
    window.addEventListener('popstate', process)
    window.addEventListener('online', process)
    const retry = setInterval(() => { if (loadIntakeQueue().length) process() }, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', process)
      window.removeEventListener('popstate', process)
      window.removeEventListener('online', process)
      clearInterval(retry)
    }
  }, [process])

  const dismiss = useCallback(() => setReceived(null), [])

  return { received, dismiss, process }
}
