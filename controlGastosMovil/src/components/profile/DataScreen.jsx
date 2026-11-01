import { useState } from 'react'
import { useSettings } from '../../context/SettingsContext'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useBudget } from '../../hooks/useBudget'
import { useApp } from '../../context/AppContext'
import { sendMonthlyReport } from '../../services/api'
import {
  buildCsv, buildExportPayload, downloadText, exportErrorMessage, fetchAllTransactions, fetchExtras,
} from '../../utils/exportData'
import { localISODate } from '../../utils'
import { Section, Row } from './ui'

export default function DataScreen() {
  const { settings, hiddenCategories = [] } = useSettings()
  const finance = useFinanceData()
  const { allItems: budgetItems } = useBudget()
  const { showToast } = useApp()
  const [sendingReport, setSendingReport] = useState(false)
  // Exportación: null | 'json' | 'csv' (preparando)
  const [exporting, setExporting] = useState(null)
  const [exportError, setExportError] = useState('')

  async function handleSendReport() {
    setSendingReport(true)
    try {
      await sendMonthlyReport()
      showToast('📧 Informe enviado a tu email')
    } catch (e) {
      showToast(e.message.includes('RESEND_API_KEY')
        ? '⚠️ Envío de email no configurado'
        : '⚠️ No se pudo enviar el informe')
    } finally {
      setSendingReport(false)
    }
  }

  // Pide los movimientos de todos los años y, según el formato, genera el fichero.
  async function runExport(kind) {
    if (exporting) return
    setExporting(kind)
    setExportError('')
    try {
      const { transactions, years, unreadable } = await fetchAllTransactions(finance?.data?.availableYears)
      const day = localISODate()
      if (kind === 'csv') {
        downloadText(buildCsv(transactions), `mi-economia-movimientos-${day}.csv`, 'text/csv;charset=utf-8')
        showToast(`📄 ${transactions.length} movimientos exportados`)
      } else {
        const extras = await fetchExtras()
        const payload = buildExportPayload({
          budget: budgetItems, settings, hiddenCategories, transactions, years, unreadable, ...extras,
        })
        downloadText(JSON.stringify(payload, null, 2), `mi-economia-${day}.json`, 'application/json')
        showToast('📤 Datos exportados')
      }
      if (unreadable) setExportError(`${unreadable} movimientos no se pudieron leer en el servidor y no están en el fichero.`)
    } catch (e) {
      setExportError(exportErrorMessage(e))
    } finally {
      setExporting(null)
    }
  }

  return (
    <>
      <Section title="Exportar">
        <Row icon="📤" label="Exportar datos">
          <button type="button" className="s-action-btn s-touch" aria-label="Exportar datos (JSON)" onClick={() => runExport('json')} disabled={!!exporting}>
            {exporting === 'json' ? 'Preparando…' : 'Exportar'}
          </button>
        </Row>
        <Row icon="📄" label="Exportar movimientos (CSV)" last>
          <button type="button" className="s-action-btn s-touch" aria-label="Exportar movimientos en CSV" onClick={() => runExport('csv')} disabled={!!exporting}>
            {exporting === 'csv' ? 'Preparando…' : 'Exportar'}
          </button>
        </Row>
        {exportError && <p className="s-note s-note--error" role="alert">{exportError}</p>}
        <p className="s-note">El JSON incluye todo (movimientos, presupuesto, metas y ajustes); el CSV solo los movimientos, para abrirlos en una hoja de cálculo.</p>
      </Section>

      <Section title="Informe por email">
        <Row icon="📧" label="Informe mensual por email" last>
          <button type="button" className="s-action-btn s-touch" aria-label="Enviar informe mensual ahora" onClick={handleSendReport} disabled={sendingReport}>
            {sendingReport ? 'Enviando…' : 'Enviar ahora'}
          </button>
        </Row>
      </Section>
    </>
  )
}
