import { useState } from 'react'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { BUDGET_COLORS } from '../../hooks/useBudget'
import { DEFAULT_CATEGORIES } from '../../data/categories'
import { useCategories } from '../../hooks/useCategories'
import { useSettings } from '../../context/SettingsContext'
import { fmt } from '../../utils'
import { FormScreen, Field, Section, AmountInput, Chips, Segmented, TileGrid, PrimaryButton, DangerButton, ConfirmSheet, Icon } from './FormKit'

const TIPOS = [
  { id: 'Gasto Variable', label: 'Variable' },
  { id: 'Gasto Fijo',     label: 'Fijo' },
]

function inferTipo(name) {
  if (!name) return 'Gasto Variable'
  for (const tipo of ['Gasto Variable', 'Gasto Fijo']) {
    if (DEFAULT_CATEGORIES[tipo].some(c => c.concepto === name)) return tipo
  }
  return 'Gasto Variable'
}

const QUICK_LIMITS = [50, 100, 200, 500].map(v => ({ key: v, label: fmt(v), value: v }))

export default function BudgetModal({ item, onSave, onClose, onDelete }) {
  useLockBodyScroll()
  const isEdit = !!item
  const { customCategories } = useSettings()
  const filteredCategories = useCategories()

  const [tipo, setTipo]           = useState(item?.tipo || inferTipo(item?.name))
  const [selectedCat, setSelectedCat] = useState(
    item ? { concepto: item.name, emoji: item.emoji } : null
  )
  const [limit, setLimit] = useState(item?.limit != null ? item.limit.toString() : '')
  const [color, setColor] = useState(item?.color || BUDGET_COLORS[0])
  const [touched, setTouched] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  const allCats = [...filteredCategories[tipo], ...(customCategories[tipo] || [])]
  const limitNum = parseFloat(String(limit).replace(',', '.'))
  const limitOk  = limitNum > 0
  const canSave = !!selectedCat && limitOk && !saving

  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

  function handleTipoChange(t) {
    setTipo(t)
    setSelectedCat(null)
  }

  async function handleSubmit() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      await onSave({
        emoji: selectedCat.emoji,
        name:  selectedCat.concepto,
        limit: limitNum || 0,
        color,
        tipo,
      })
    } catch (e) {
      setError(e?.message || 'No se pudo guardar')
      setSaving(false)
    }
  }

  const missing = !selectedCat ? 'Elige una categoría para continuar' : 'Indica un límite mensual mayor que 0'

  return (
    <FormScreen
      title={isEdit ? 'Editar presupuesto' : 'Nuevo presupuesto'}
      subtitle="Fija cuánto quieres gastar al mes en una categoría."
      onClose={onClose}
      error={error}
      footer={
        <PrimaryButton loading={saving} disabled={!canSave} hint={missing} onClick={handleSubmit}>
          {isEdit ? 'Guardar cambios' : 'Crear presupuesto'}
        </PrimaryButton>
      }
    >
      {/* Vista previa en vivo */}
      <div className="fm-preview" aria-label="Vista previa del presupuesto">
        <span className="fm-preview-tag">Vista previa</span>
        <div className="fm-preview-row">
          <span className="fm-preview-tile">{selectedCat?.emoji || '🎯'}</span>
          <div className="fm-preview-main">
            <span className={`fm-preview-name${selectedCat ? '' : ' muted'}`}>{selectedCat?.concepto || 'Elige una categoría'}</span>
            <span className="fm-preview-sub">{tipo === 'Gasto Fijo' ? 'Gasto fijo' : 'Gasto variable'} · al mes</span>
          </div>
          <span className="fm-preview-amount tabular">{fmt(limitOk ? limitNum : 0)}</span>
        </div>
        <div className="fm-preview-bar"><div className="fm-preview-bar-fill" style={{ width: '60%', background: color, boxShadow: `0 0 10px ${color}66` }} /></div>
        <span className="fm-preview-foot tabular">
          {limitOk ? `≈ ${fmt(limitNum / daysInMonth)} al día` : 'Verás cuánto puedes gastar al día'}
        </span>
      </div>

      <Section title="Tipo de gasto">
        <Segmented
          label="Tipo de gasto"
          value={tipo}
          onChange={handleTipoChange}
          options={TIPOS}
        />
      </Section>

      <Section title="Categoría">
        {allCats.length === 0 ? (
          <p className="fm-hint">No hay categorías de este tipo.</p>
        ) : (
          <TileGrid
            label="Categoría"
            columns={3}
            items={allCats.map(c => ({ key: c.concepto, icon: c.emoji, label: c.concepto, cat: c }))}
            isSelected={it => selectedCat?.concepto === it.cat.concepto}
            onSelect={it => setSelectedCat(it.cat)}
          />
        )}
      </Section>

      <Field
        label="Límite mensual"
        hint="El gasto real se obtiene automáticamente de tus transacciones."
        error={touched && !limitOk ? 'Introduce un importe mayor que 0.' : ''}
      >
        {({ id, describedBy, invalid }) => (
          <>
            <AmountInput id={id} describedBy={describedBy} invalid={invalid} value={limit}
              onChange={setLimit} onBlur={() => setTouched(true)} />
            <Chips
              label="Importes rápidos"
              options={QUICK_LIMITS}
              isActive={o => limitNum === o.value}
              onPick={o => { setLimit(String(o.value)); setTouched(true) }}
            />
          </>
        )}
      </Field>

      <Section title="Color de la barra">
        <div className="fm-swatches" role="radiogroup" aria-label="Color de la barra">
          {BUDGET_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Color ${i + 1}`}
              className={`fm-swatch${color === c ? ' selected' : ''}`}
              onClick={() => setColor(c)}
            >
              <span className="fm-swatch-dot" style={{ background: c }}>
                {color === c && <Icon name="check" size={16} />}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {onDelete && (
        <DangerButton onClick={() => setConfirmDel(true)}>Eliminar presupuesto</DangerButton>
      )}

      {confirmDel && (
        <ConfirmSheet
          title="¿Eliminar este presupuesto?"
          message={`Se quitará "${item?.name}" de tu planificación. Tus transacciones no se tocan.`}
          onCancel={() => setConfirmDel(false)}
          onConfirm={() => onDelete()}
        />
      )}
    </FormScreen>
  )
}
