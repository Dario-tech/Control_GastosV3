import { useEffect, useState } from 'react'
import { useSettings } from '../../context/SettingsContext'
import { normalizeCategoryName } from '../../data/categories'
import { Sheet } from './FormKit'
import { CategoryFields, useEmojiSuggest, validateCategoryName, DUPLICATE_CAT_MSG } from './CategoryFields'

/* Botón «＋ Nueva categoría» que se coloca encima de las rejillas de categorías
   (añadir gasto, editar movimiento, categorizar un pendiente). */
export function NewCategoryButton({ onClick, disabled }) {
  return (
    <button type="button" className="fm-newcat-btn" onClick={e => { e.currentTarget.focus({ preventScroll: true }); onClick() }} disabled={disabled}>
      <span className="fm-newcat-btn-plus" aria-hidden="true">＋</span>
      <span>Nueva categoría</span>
    </button>
  )
}

/* Hoja inferior para crear una categoría sin salir del formulario que la
   necesita. El tipo viene fijado por el movimiento. Al crear llama a
   `onCreated(nombre)` (el padre la selecciona) y se cierra; nunca guarda nada
   más. `existing` = categorías visibles de ese tipo (para detectar duplicados). */
export default function NewCategorySheet({ tipo, existing, onCreated, onClose, confirmLabel = 'Crear' }) {
  const { addCategory } = useSettings()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [dupName, setDupName] = useState(null)
  // Quién tenía el foco al abrir (el autoFocus del campo lo mueve antes de que
  // lo capture la trampa de foco de la hoja): se le devuelve al cerrar.
  const [opener] = useState(() => document.activeElement)
  useEffect(() => () => {
    if (opener instanceof HTMLElement && document.contains(opener)) opener.focus({ preventScroll: true })
  }, [opener])
  const { emoji, setEmoji, suggesting, suggest } = useEmojiSuggest()

  function findExisting(n) {
    const k = normalizeCategoryName(n)
    return (existing || []).find(c => normalizeCategoryName(c.concepto) === k)?.concepto ?? null
  }

  function fail(msg, n) {
    setError(msg)
    setDupName(msg === DUPLICATE_CAT_MSG ? findExisting(n) : null)
  }

  function handleCreate() {
    const clean = String(name || '').replace(/\s+/g, ' ').trim()
    const { error: nameErr } = validateCategoryName(clean, existing)
    if (nameErr) { fail(nameErr, clean); return }
    // addCategory es optimista y sincroniza con el servidor en segundo plano.
    if (addCategory(tipo, { concepto: clean, emoji }) === false) { fail(DUPLICATE_CAT_MSG, clean); return }
    onCreated(clean)
    onClose()
  }

  return (
    <Sheet title="Nueva categoría" label="Nueva categoría" onClose={onClose}>
      <p className="fm-sheet-msg">Se creará en <strong>{tipo}</strong> y quedará elegida. Lo que ya has escrito no se pierde.</p>
      <CategoryFields emoji={emoji} onEmoji={setEmoji} name={name}
        onName={v => { setName(v); setError(''); setDupName(null) }} error={error}
        suggesting={suggesting} onSuggest={() => suggest(name)} onEnter={handleCreate} />
      {dupName && (
        <button type="button" className="fm-secondary" onClick={() => { onCreated(dupName); onClose() }}>
          Usar «{dupName}»
        </button>
      )}
      <div className="fm-sheet-actions">
        <button type="button" className="fm-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="fm-confirm" onClick={handleCreate}><span>{confirmLabel}</span></button>
      </div>
    </Sheet>
  )
}
