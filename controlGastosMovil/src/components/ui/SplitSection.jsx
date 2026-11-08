import { useEffect, useMemo, useState } from 'react'
import { addSharedPerson } from '../../services/api'
import { equalSplit, parseAmountInput, splitDifference } from '../../utils/groups'
import { fmt } from '../../utils'
import { Field, Chips, Segmented, SwitchRow } from './FormKit'

const MODOS = [{ id: 'igual', label: 'A partes iguales' }, { id: 'importes', label: 'Por importes' }]

/**
 * «Dividir» al apuntar un gasto: con quién se reparte, quién pagó y cómo.
 * Informa al formulario con onChange(null | { payload, error }): null = no se divide;
 * payload = { pagado_por, reparto, etiqueta } listo para POST /api/shared/expenses;
 * error = texto si el reparto aún no es válido (el botón Guardar se bloquea).
 * Las personas son contactos propios sin cuenta (se crean aquí mismo).
 */
export default function SplitSection({ total, shared, onChange }) {
  const { state, apply, loading } = shared
  const [on, setOn]           = useState(false)
  const [sel, setSel]         = useState([])          // claves de personas con las que se reparte
  const [payer, setPayer]     = useState('yo')
  const [modo, setModo]       = useState('igual')
  const [amounts, setAmounts] = useState({})          // clave → texto
  const [etiqueta, setEtiqueta] = useState('')
  const [nuevo, setNuevo]     = useState('')
  const [err, setErr]         = useState('')
  const [busy, setBusy]       = useState(false)

  const personas = state.personas
  const nombre = k => (k === 'yo' ? 'Yo' : personas.find(p => p.clave === k)?.nombre ?? '?')
  const parts = useMemo(() => ['yo', ...sel], [sel])

  const result = useMemo(() => {
    if (!on) return null
    if (!sel.length) return { error: 'Elige con quién dividir' }
    const base = { pagado_por: payer, etiqueta: etiqueta.trim() || null }
    if (modo === 'igual') return { payload: { ...base, reparto: { modo: 'igual', participantes: parts } } }
    const partes = {}
    for (const k of parts) {
      const v = parseAmountInput(amounts[k])
      if (v) partes[k] = v
    }
    const dif = splitDifference(total, partes)
    if (!Object.keys(partes).length || dif !== 0) {
      return { error: dif > 0 ? `Faltan ${fmt(dif, 2)} por repartir` : dif < 0 ? `Te pasas ${fmt(-dif, 2)}` : 'Escribe las partes' }
    }
    return { payload: { ...base, reparto: { modo: 'importes', partes } } }
  }, [on, sel, parts, payer, modo, amounts, etiqueta, total])

  useEffect(() => { onChange(result) }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = k => {
    setSel(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k])
    if (payer === k) setPayer('yo')
  }

  async function crear(e) {
    e.preventDefault()
    const n = nuevo.trim()
    if (!n || busy) return
    setBusy(true); setErr('')
    try {
      const antes = new Set(personas.map(p => p.clave))
      const st = await addSharedPerson(n)
      apply(st)
      const creada = st.personas.find(p => !antes.has(p.clave))
      if (creada) setSel(s => [...s, creada.clave])
      setNuevo('')
    } catch (er) { setErr(er.message) } finally { setBusy(false) }
  }

  const sugeridas = modo === 'igual' ? equalSplit(total, parts) : null

  return (
    <div className="split-section">
      <SwitchRow checked={on} onChange={setOn} title="Dividir con otras personas"
        desc="Tu economía cuenta lo que pagas; lo que te deben queda en «Cuentas»." />
      {on && (
        <>
          <Field label="¿Con quién?">
            {() => (
              <>
                {loading && <p className="s-note">Cargando…</p>}
                <Chips label="Personas" align="start" options={personas.map(p => ({ key: p.clave, label: p.nombre }))}
                  isActive={o => sel.includes(o.key)} onPick={o => toggle(o.key)} />
                <form className="grp-form grp-form--flush" onSubmit={crear}>
                  <input className="fm-input" value={nuevo} onChange={e => setNuevo(e.target.value)} maxLength={60}
                    placeholder="Añadir persona (solo el nombre)" aria-label="Nombre de la nueva persona" autoComplete="off" />
                  <button type="submit" className="s-action-btn s-touch" disabled={busy || !nuevo.trim()}>Añadir</button>
                </form>
                {err && <p className="fm-error" role="alert">{err}</p>}
              </>
            )}
          </Field>

          {sel.length > 0 && (
            <>
              <Field label="¿Quién pagó?">
                {() => (
                  <Chips label="Quién pagó" align="start"
                    options={parts.map(k => ({ key: k, label: k === 'yo' ? 'Yo' : nombre(k) }))}
                    isActive={o => payer === o.key} onPick={o => setPayer(o.key)} />
                )}
              </Field>
              <Field label="Reparto">
                {() => (
                  <>
                    <Segmented label="Tipo de reparto" options={MODOS} value={modo} onChange={setModo} />
                    {parts.map(k => (
                      <div className="grp-part" key={k}>
                        <span>{nombre(k)}</span>
                        {modo === 'igual'
                          ? <span className="grp-share">{fmt(sugeridas[k] ?? 0, 2)}</span>
                          : <input className="fm-input grp-part-input" inputMode="decimal" placeholder="0,00"
                              aria-label={`Parte de ${nombre(k)}`} value={amounts[k] ?? ''}
                              onChange={e => setAmounts(a => ({ ...a, [k]: e.target.value }))} />}
                      </div>
                    ))}
                    {result?.error && <p className="fm-warn" role="status">{result.error}</p>}
                  </>
                )}
              </Field>
            </>
          )}
          <Field label="Etiqueta (viaje, piso…)" optional>
            {({ id }) => (
              <input id={id} className="fm-input" value={etiqueta} onChange={e => setEtiqueta(e.target.value)}
                maxLength={40} placeholder="Ej.: Lisboa" autoComplete="off" />
            )}
          </Field>
        </>
      )}
    </div>
  )
}
