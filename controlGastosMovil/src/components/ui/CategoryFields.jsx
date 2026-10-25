import { useState } from 'react'
import { suggestEmoji } from '../../services/api'
import { EMOJI_SUGGESTIONS, categoryExists } from '../../data/categories'
import { Icon } from './FormKit'

export const DUPLICATE_CAT_MSG = 'Ya existe una categoría con ese nombre'
export const EMPTY_CAT_MSG = 'Escribe un nombre'
export const CAT_NAME_MAX = 32
export const AI_HINT = 'Envía solo el nombre de la categoría a un servicio de IA para sugerir el emoji'
const AI_HINT_ID = 'cat-ai-hint'

/* Valida el nombre de una categoría nueva con las mismas reglas en todas las
   pantallas. `existing` = categorías visibles del tipo (por defecto + propias).
   Devuelve { name, error }. */
export function validateCategoryName(raw, existing) {
  const name = String(raw || '').trim()
  if (!name) return { name, error: EMPTY_CAT_MSG }
  if (categoryExists(existing, name)) return { name, error: DUPLICATE_CAT_MSG }
  return { name, error: '' }
}

/* Estado de emoji + sugerencia con IA (best effort: si falla, se elige a mano). */
export function useEmojiSuggest(initial = '💶') {
  const [emoji, setEmoji] = useState(initial)
  const [suggesting, setSuggesting] = useState(false)
  async function suggest(rawName) {
    const name = String(rawName || '').trim()
    if (!name || suggesting) return
    setSuggesting(true)
    try {
      const { emoji: e } = await suggestEmoji(name)
      setEmoji(e)
    } catch {
      // silencioso: el usuario sigue pudiendo elegir emoji a mano
    } finally {
      setSuggesting(false)
    }
  }
  return { emoji, setEmoji, suggesting, suggest }
}

/* Selector de emoji + nombre + botón de sugerencia + error inline. */
export function CategoryFields({ emoji, onEmoji, name, onName, error, suggesting, onSuggest, onEnter, autoFocus = true }) {
  return (
    <>
      <div className="fm-emoji-scroll" role="radiogroup" aria-label="Emoji">
        {EMOJI_SUGGESTIONS.map(e => (
          <button key={e} type="button" role="radio" aria-checked={emoji === e}
            className={`fm-emoji${emoji === e ? ' selected' : ''}`} onClick={() => onEmoji(e)}>{e}</button>
        ))}
      </div>
      <div className="fm-newcat-row">
        <span className="fm-newcat-emoji" aria-hidden="true">{emoji}</span>
        <input className="fm-input" placeholder="Nombre de la categoría" value={name} maxLength={CAT_NAME_MAX}
          aria-invalid={!!error || undefined} aria-label="Nombre de la categoría"
          onChange={e => onName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onEnter?.()} autoFocus={autoFocus} />
        <button type="button" className="fm-icon-btn" onClick={onSuggest}
          disabled={!name.trim() || suggesting} aria-label="Sugerir emoji con IA" aria-describedby={AI_HINT_ID} title={AI_HINT}>
          {suggesting ? <span className="fm-spinner" aria-hidden="true" /> : '✨'}
        </button>
      </div>
      <span id={AI_HINT_ID} className="sr-only">{AI_HINT}</span>
      {name.length >= CAT_NAME_MAX && !error && (
        <p className="fm-hint" role="status">{name.length}/{CAT_NAME_MAX} caracteres: es el máximo</p>
      )}
      {error && <p className="fm-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
    </>
  )
}
