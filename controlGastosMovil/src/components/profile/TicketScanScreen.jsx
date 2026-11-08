import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { fetchTicketScanStatus, scanTicket, createPending } from '../../services/api'
import { prepareTicketImage } from '../../utils/ticketImage'
import { parseAmountInput } from '../../utils/groups'
import { todayLocal } from '../../utils'
import { Section } from './ui'

/* Escanear un ticket con IA. Pasos: aviso de privacidad → foto → lectura → revisión
   editable → crear gasto PENDIENTE. Nada se guarda sin que el usuario confirme. */
export default function TicketScanScreen({ onDone }) {
  const { showToast } = useApp()
  const [available, setAvailable] = useState(null)   // null = comprobando
  const [step, setStep] = useState('aviso')           // aviso | foto | leyendo | revision
  const [error, setError] = useState('')
  const [importe, setImporte] = useState('')
  const [comercio, setComercio] = useState('')
  const [fecha, setFecha] = useState(todayLocal())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    fetchTicketScanStatus().then(r => alive && setAvailable(!!r?.disponible)).catch(() => alive && setAvailable(false))
    return () => { alive = false }
  }, [])

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setStep('leyendo')
    try {
      const imagen = await prepareTicketImage(file)
      const r = await scanTicket(imagen)
      setImporte(r.importe != null ? String(r.importe).replace('.', ',') : '')
      setComercio(r.comercio || '')
      setFecha(r.fecha || todayLocal())
      setStep('revision')
    } catch (err) {
      setError(err.message || 'No se pudo leer el ticket.')
      setStep('foto')
    }
  }

  async function onConfirm(e) {
    e.preventDefault()
    const amt = parseAmountInput(importe)
    if (!amt) { setError('Revisa el importe (mayor que 0, ej. 12,50).'); return }
    setSaving(true); setError('')
    try {
      await createPending({ importe: amt, comercio: comercio.trim() || undefined, fecha, fuente: 'manual' })
      showToast('🧾 Pendiente creado: categorízalo desde el aviso de pendientes')
      onDone?.()
    } catch (err) {
      setError(err.message || 'No se pudo crear el pendiente.')
    } finally {
      setSaving(false)
    }
  }

  if (available === null) return <p className="s-note s-note--top" role="status">Comprobando…</p>
  if (!available) {
    return <p className="s-note s-note--top">La lectura de tickets con IA no está disponible ahora mismo. Puedes añadir el gasto a mano con el botón «+».</p>
  }

  return (
    <>
      {step === 'aviso' && (
        <Section title="Antes de empezar">
          <div className="tk-pad">
            <p className="tk-text">Para leer el ticket, <strong>la foto se envía a un servicio externo (la API de Claude, de Anthropic)</strong>. Nuestro servidor no la guarda ni en disco ni en la base de datos, y la foto se reduce y se le quitan los metadatos (como la ubicación) antes de enviarla.</p>
            <p className="tk-text">Evita fotos donde salgan datos que no quieras compartir (tarjetas, nombres, direcciones). El resultado es solo una propuesta: tú la revisas y confirmas antes de crear nada.</p>
            <button type="button" className="s-action-btn s-touch" onClick={() => setStep('foto')}>Entiendo, continuar</button>
          </div>
        </Section>
      )}

      {(step === 'foto' || step === 'leyendo') && (
        <Section title="Foto del ticket">
          <div className="tk-pad">
            <label className={`s-action-btn s-touch tk-pick${step === 'leyendo' ? ' disabled' : ''}`}>
              📷 Hacer foto
              <input type="file" accept="image/*" capture="environment" onChange={onPick} disabled={step === 'leyendo'} aria-label="Hacer foto al ticket" className="tk-file" />
            </label>
            <label className={`s-action-btn s-touch tk-pick${step === 'leyendo' ? ' disabled' : ''}`}>
              🖼️ Elegir imagen
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} disabled={step === 'leyendo'} aria-label="Elegir imagen del ticket" className="tk-file" />
            </label>
            {step === 'leyendo' && <p className="tk-text" role="status">Leyendo el ticket…</p>}
          </div>
        </Section>
      )}

      {step === 'revision' && (
        <Section title="Revisa los datos">
          <form className="tk-pad" onSubmit={onConfirm}>
            <p className="tk-text">Esto es lo que he leído. Corrígelo si hace falta: no se crea nada hasta que pulses el botón.</p>
            <label className="grp-label">Importe
              <input className="fm-input" inputMode="decimal" value={importe} onChange={e => setImporte(e.target.value)} placeholder="0,00" aria-label="Importe" />
            </label>
            <label className="grp-label">Comercio
              <input className="fm-input" value={comercio} onChange={e => setComercio(e.target.value)} maxLength={120} placeholder="Opcional" aria-label="Comercio" />
            </label>
            <label className="grp-label">Fecha
              <input className="fm-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} aria-label="Fecha" />
            </label>
            <div className="grp-actions">
              <button type="button" className="s-action-btn s-touch" onClick={() => { setStep('foto'); setError('') }}>Otra foto</button>
              <button type="submit" className="s-action-btn s-touch" disabled={saving}>{saving ? 'Creando…' : 'Crear pendiente'}</button>
            </div>
          </form>
        </Section>
      )}

      {error && <p className="s-note s-note--error" role="alert">{error}</p>}
    </>
  )
}
