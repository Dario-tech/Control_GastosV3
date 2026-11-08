import { useCallback, useEffect, useState } from 'react'
import { fetchShared } from '../services/api'
import { useFinanceData } from '../context/FinanceDataContext'

const VACIO = { personas: [], gastos: [], pagos: [], por_transaccion: {}, saldo_total: 0 }

/**
 * Estado de los gastos compartidos (personas, saldos, reparto por movimiento).
 * Se recarga al montar y cada vez que cambian los movimientos (alta, edición, SSE),
 * así que el distintivo «te deben» y los saldos siguen a /api/finance.
 * `set` permite aplicar al instante el estado que devuelven las escrituras.
 */
export function useShared() {
  const { transactions } = useFinanceData()
  const [state, setState] = useState(null)   // null = cargando
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try { setState(await fetchShared()); setError('') }
    catch (e) { setError(e.message || 'No se pudieron cargar las cuentas.'); setState(s => s ?? VACIO) }
  }, [])
  useEffect(() => { reload() }, [reload, transactions])

  const apply = useCallback(next => { if (next && next.personas) setState(next) }, [])
  return { state: state ?? VACIO, loading: state === null, error, reload, apply }
}
