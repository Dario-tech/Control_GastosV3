import { useState, useMemo } from 'react'
import { FormScreen, Field, Section, Segmented, PrimaryButton } from './FormKit'
import { useFinanceData } from '../../context/FinanceDataContext'
import { useApp } from '../../context/AppContext'
import { importTransactions } from '../../services/api'
import {
  DELIMITERS, DATE_FORMATS, MAX_FILE_BYTES, MAX_ROWS, CHUNK,
  detectDelimiter, parseCsv, guessColumns, buildRows,
} from '../../utils/csvImport'
import { fmt } from '../../utils'

const SIGN_OPTIONS = [
  { id: 'signo',  label: 'Por el signo' },
  { id: 'gastos', label: 'Todo gastos' },
]

function chunks(list) {
  const out = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

/* Importar un extracto del banco: fichero → columnas → revisión (duplicados) → confirmar. */
export default function CsvImportScreen({ onClose }) {
  const finance = useFinanceData()
  const { showToast } = useApp()
  const [text, setText] = useState(null)
  const [fileName, setFileName] = useState('')
  const [delimiter, setDelimiter] = useState(';')
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState({ fecha: 0, concepto: 1, importe: 2 })
  const [dateFormat, setDateFormat] = useState('dmy')
  const [signMode, setSignMode] = useState('signo')
  const [review, setReview] = useState(null)   // { nuevas, duplicadas, errores, omitidas }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const matrix = useMemo(() => (text == null ? [] : parseCsv(text, delimiter)), [text, delimiter])
  const headers = hasHeader ? (matrix[0] || []) : (matrix[0] || []).map((_, i) => `Columna ${i + 1}`)
  const built = useMemo(
    () => (matrix.length ? buildRows(matrix, { mapping, hasHeader, dateFormat, signMode }) : { filas: [], omitidas: [] }),
    [matrix, mapping, hasHeader, dateFormat, signMode],
  )

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    if (file.size > MAX_FILE_BYTES) { setError('El fichero es demasiado grande (máx. 1 MB).'); return }
    try {
      const raw = await file.text()
      const d = detectDelimiter(raw)
      const m = parseCsv(raw, d)
      if (m.length < 2) { setError('No encuentro filas en el fichero.'); return }
      if (m.length > MAX_ROWS + 1) { setError(`Demasiadas filas (máx. ${MAX_ROWS}). Divide el extracto por periodos.`); return }
      const g = guessColumns(m[0])
      setFileName(file.name); setText(raw); setDelimiter(d); setHasHeader(true); setReview(null)
      setMapping({ fecha: Math.max(g.fecha, 0), concepto: Math.max(g.concepto, 0), importe: Math.max(g.importe, 0) })
    } catch {
      setError('No se pudo leer el fichero.')
    }
  }

  function setCol(key, value) { setReview(null); setMapping(m => ({ ...m, [key]: Number(value) })) }

  async function runReview() {
    setBusy(true); setError('')
    try {
      const nuevas = [], duplicadas = []
      let errores = 0
      for (const part of chunks(built.filas)) {
        const res = await importTransactions(part.map(({ linea: _l, ...f }) => f), false)
        for (const r of res.filas) {
          const src = part[r.i]
          if (r.estado === 'nueva') nuevas.push(src)
          else if (r.estado === 'duplicada') duplicadas.push(src)
          else errores++
        }
      }
      setReview({ nuevas, duplicadas, errores, omitidas: built.omitidas.length })
    } catch (e) {
      setError(e.message || 'No se pudo revisar el extracto.')
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    setBusy(true); setError('')
    try {
      let importadas = 0
      for (const part of chunks(review.nuevas)) {
        const res = await importTransactions(part.map(({ linea: _l, ...f }) => f), true)
        importadas += res.importadas
      }
      showToast(`📥 ${importadas} movimientos importados`)
      finance?.refresh?.()
      onClose()
    } catch (e) {
      setError(e.message || 'No se pudo importar. Revisa y vuelve a intentarlo: no se duplicará nada.')
    } finally {
      setBusy(false)
    }
  }

  const colSelect = (key, label) => (
    <Field label={label}>
      {({ id }) => (
        <select id={id} className="fm-input" value={mapping[key]} onChange={e => setCol(key, e.target.value)}>
          {headers.map((h, i) => <option key={i} value={i}>{String(h).slice(0, 40) || `Columna ${i + 1}`}</option>)}
        </select>
      )}
    </Field>
  )

  let footer
  if (review) {
    footer = (
      <PrimaryButton loading={busy} disabled={!review.nuevas.length} onClick={runImport} hint="No hay movimientos nuevos que importar.">
        {`Importar ${review.nuevas.length} movimientos`}
      </PrimaryButton>
    )
  } else if (text != null) {
    footer = (
      <PrimaryButton loading={busy} disabled={!built.filas.length} onClick={runReview} hint="Ninguna fila es válida con estas columnas.">
        Revisar antes de guardar
      </PrimaryButton>
    )
  }

  return (
    <FormScreen title="Importar extracto" subtitle="CSV del banco. Nada se guarda hasta que lo confirmes." onClose={onClose} footer={footer} error={error}>
      <Section title="Fichero">
        <label className="s-action-btn s-touch" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {text == null ? 'Elegir CSV' : 'Cambiar fichero'}
          <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onPick} aria-label="Elegir fichero CSV" style={{ display: 'none' }} />
        </label>
        {fileName && <p className="fm-hint">{fileName} · {Math.max(matrix.length - (hasHeader ? 1 : 0), 0)} filas</p>}
      </Section>

      {text != null && !review && (
        <>
          <Section title="Formato">
            <Field label="Separador">
              {({ id }) => (
                <select id={id} className="fm-input" value={delimiter} onChange={e => { setReview(null); setDelimiter(e.target.value) }}>
                  {DELIMITERS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              )}
            </Field>
            <Field label="Formato de fecha">
              {({ id }) => (
                <select id={id} className="fm-input" value={dateFormat} onChange={e => { setReview(null); setDateFormat(e.target.value) }}>
                  {DATE_FORMATS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              )}
            </Field>
            <Field label="La primera fila son cabeceras">
              <Segmented label="Primera fila" value={hasHeader} onChange={v => { setReview(null); setHasHeader(v) }}
                options={[{ id: true, label: 'Sí' }, { id: false, label: 'No' }]} />
            </Field>
          </Section>

          <Section title="Columnas">
            {colSelect('fecha', 'Fecha')}
            {colSelect('concepto', 'Concepto / comercio')}
            {colSelect('importe', 'Importe')}
            <Field label="Gasto o ingreso" hint="Por el signo: negativo = gasto, positivo = ingreso. Los gastos entran como «Gasto Variable»; recategorízalos después.">
              <Segmented label="Tipo" value={signMode} onChange={v => { setReview(null); setSignMode(v) }} options={SIGN_OPTIONS} />
            </Field>
          </Section>

          <Section title="Vista previa">
            {built.filas.slice(0, 5).map(f => (
              <p key={f.linea} className="fm-hint">
                {f.fecha} · {f.concepto.slice(0, 28)} · {f.tipo === 'Ingreso' ? '+' : '−'}{f.importe}
              </p>
            ))}
            {!built.filas.length && <p className="fm-hint">Ninguna fila válida con estas columnas.</p>}
            {built.omitidas.length > 0 && <p className="fm-hint">{built.omitidas.length} filas se saltarán (fecha, concepto o importe no válidos).</p>}
          </Section>
        </>
      )}

      {review && (
        <Section title="Resultado de la revisión">
          <p className="fm-hint"><strong>{fmt(review.nuevas.length)}</strong> nuevos para importar</p>
          <p className="fm-hint"><strong>{fmt(review.duplicadas.length)}</strong> ya estaban guardados (misma fecha, importe y comercio): se omiten</p>
          {(review.errores + review.omitidas) > 0 && (
            <p className="fm-hint">{review.errores + review.omitidas} filas no válidas: se omiten</p>
          )}
          {review.duplicadas.slice(0, 5).map(f => (
            <p key={f.linea} className="fm-hint">↺ {f.fecha} · {f.concepto.slice(0, 28)} · {f.importe}</p>
          ))}
          <button type="button" className="s-action-btn s-touch" onClick={() => setReview(null)}>Volver a las columnas</button>
        </Section>
      )}
    </FormScreen>
  )
}
