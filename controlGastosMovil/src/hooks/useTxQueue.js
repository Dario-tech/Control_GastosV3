import { useCallback, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { flushTxQueue, loadTxQueue } from '../utils/txQueue'

/* Reenvía los movimientos guardados sin conexión: al abrir la app, al volver
   'online', al volver a primer plano y cada minuto mientras haya cola. */
export function useTxQueue({ onChange } = {}) {
  const { showToast } = useApp()

  const flush = useCallback(async () => {
    if (!loadTxQueue().length) return
    const { sent, dropped } = await flushTxQueue()
    if (sent) {
      onChange?.()
      showToast(sent === 1 ? 'Movimiento guardado' : `${sent} movimientos guardados`)
    }
    if (dropped) showToast('Un movimiento guardado sin conexión fue rechazado por el servidor', { error: true })
  }, [showToast, onChange])

  useEffect(() => {
    flush()
    const onVisible = () => { if (document.visibilityState === 'visible') flush() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', flush)
    window.addEventListener('pageshow', flush)
    const retry = setInterval(flush, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', flush)
      window.removeEventListener('pageshow', flush)
      clearInterval(retry)
    }
  }, [flush])

  return { flush }
}
