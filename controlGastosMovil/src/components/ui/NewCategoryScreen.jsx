import { useState } from 'react'
import { useSettings } from '../../context/SettingsContext'
import { useApp } from '../../context/AppContext'
import { useCategories } from '../../hooks/useCategories'
import { TYPES, combineCategories } from '../../data/categories'
import { FormScreen, Field, Segmented, PrimaryButton } from './FormKit'
import { CategoryFields, useEmojiSuggest, validateCategoryName, DUPLICATE_CAT_MSG } from './CategoryFields'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'

/* Crear una categoría propia desde Ajustes, sin añadir ningún gasto. */
export default function NewCategoryScreen({ onClose }) {
  useLockBodyScroll()
  const { customCategories, addCategory } = useSettings()
  const { showToast } = useApp()
  const DEFAULTS = useCategories()
  const [tipo, setTipo] = useState(TYPES[0].id)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const { emoji, setEmoji, suggesting, suggest } = useEmojiSuggest()

  function handleSave() {
    const existing = combineCategories(DEFAULTS[tipo], customCategories[tipo])
    const { name: clean, error: err } = validateCategoryName(name, existing)
    if (err) { setError(err); return }
    // addCategory sincroniza con el servidor en segundo plano (con aviso si falla).
    if (addCategory(tipo, { concepto: clean, emoji }) === false) { setError(DUPLICATE_CAT_MSG); return }
    showToast(`${emoji} Categoría «${clean.length > 20 ? clean.slice(0, 20) + '…' : clean}» creada`)
    onClose()
  }

  return (
    <FormScreen
      solid
      title="Nueva categoría"
      subtitle="Podrás usarla al añadir gastos y al categorizar pendientes."
      onClose={onClose}
      footer={<PrimaryButton onClick={handleSave}>Crear categoría</PrimaryButton>}
    >
      <Field label="Tipo">
        {() => (
          <Segmented label="Tipo de categoría" options={TYPES} value={tipo}
            onChange={t => { setTipo(t); setError('') }} />
        )}
      </Field>
      <div className="fm-card fm-newcat">
        <span className="fm-label">Emoji y nombre</span>
        <CategoryFields emoji={emoji} onEmoji={setEmoji} name={name} onName={v => { setName(v); setError('') }}
          error={error} suggesting={suggesting} onSuggest={() => suggest(name)} onEnter={handleSave} />
      </div>
    </FormScreen>
  )
}
