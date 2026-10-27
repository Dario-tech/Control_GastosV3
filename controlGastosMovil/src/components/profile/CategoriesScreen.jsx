import { Fragment, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '../../context/SettingsContext'
import NewCategoryScreen from '../ui/NewCategoryScreen'
import { ConfirmSheet } from '../ui/FormKit'
import { DEFAULT_CATEGORIES, TYPES, categoryKey, combineCategories } from '../../data/categories'
import { Section, TIPO_PLURAL, TIPO_LABEL } from './ui'

const LAST_VISIBLE_MSG = 'Debe quedar al menos una categoría visible de este tipo'
const PAGE = 10        // categorías propias por «página»
const SEARCH_FROM = 8  // a partir de cuántas propias aparece el buscador

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export default function CategoriesScreen() {
  const { customCategories, removeCategory, hiddenCategories = [], setHiddenCategories } = useSettings()
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [toRemove, setToRemove] = useState(null)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState({})   // grupos de categorías por defecto desplegados
  const newCatBtn = useRef(null)

  // Al cerrar el formulario el foco vuelve al botón que lo abrió.
  function closeNewCat() {
    setNewCatOpen(false)
    setTimeout(() => newCatBtn.current?.focus({ preventScroll: true }), 0)
  }

  const customList = ['Gasto Variable', 'Gasto Fijo', 'Ingreso']
    .flatMap(tipo => (customCategories?.[tipo] || []).map(c => ({ ...c, tipo })))
  const q = norm(query)
  const filtered = q ? customList.filter(c => norm(c.concepto).includes(q)) : customList
  const visibleList = filtered.slice(0, shown)

  // ── Categorías por defecto ocultas ──
  const hiddenKeys = new Set(hiddenCategories.map(h => categoryKey(h.tipo, h.concepto)))
  const hiddenIn = tipo => DEFAULT_CATEGORIES[tipo].filter(c => hiddenKeys.has(categoryKey(tipo, c.concepto))).length
  const hiddenCount = TYPES.reduce((n, t) => n + hiddenIn(t.id), 0)
  // Quedan elegibles en el tipo (por defecto visibles + propias) si se oculta `skip`
  const visibleLeft = (tipo, skipKey) => combineCategories(
    DEFAULT_CATEGORIES[tipo].filter(c => {
      const k = categoryKey(tipo, c.concepto)
      return k !== skipKey && !hiddenKeys.has(k)
    }),
    customCategories?.[tipo] || [],
  ).length

  function toggleDefaultCategory(tipo, concepto) {
    const k = categoryKey(tipo, concepto)
    if (hiddenKeys.has(k)) {
      setHiddenCategories?.(hiddenCategories.filter(h => categoryKey(h.tipo, h.concepto) !== k))
    } else {
      if (visibleLeft(tipo, k) < 1) return
      setHiddenCategories?.([...hiddenCategories, { tipo, concepto }])
    }
  }

  function showAllCategories() {
    // Solo las de las categorías por defecto; cualquier otra entrada se conserva
    const defaults = new Set(TYPES.flatMap(t => DEFAULT_CATEGORIES[t.id].map(c => categoryKey(t.id, c.concepto))))
    setHiddenCategories?.(hiddenCategories.filter(h => !defaults.has(categoryKey(h.tipo, h.concepto))))
  }

  return (
    <>
      <Section title="Mis categorías">
        {customList.length === 0 ? (
          <p className="s-note s-note--top">Aún no has creado ninguna. Crea la primera con el botón de abajo.</p>
        ) : (
          <>
            {customList.length > SEARCH_FROM && (
              <div className="pf-search">
                <input
                  type="search"
                  className="pf-search-input"
                  placeholder="Buscar categoría"
                  aria-label="Buscar entre mis categorías"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setShown(PAGE) }}
                  autoComplete="off"
                />
              </div>
            )}
            {visibleList.length === 0 && <p className="s-note s-note--top" role="status">Ninguna categoría coincide con la búsqueda.</p>}
            <ul className="pf-list">
              {visibleList.map((c, i) => (
                <li key={`${c.tipo}|${c.concepto}|${i}`} className="pf-cat-row">
                  <span className="pf-cat-emoji" aria-hidden="true">{c.emoji}</span>
                  <span className="pf-cat-name">{c.concepto}</span>
                  <span className="pf-cat-type">{TIPO_LABEL[c.tipo]}</span>
                  <button
                    type="button"
                    className="pf-icon-btn"
                    aria-label={`Eliminar la categoría ${c.concepto}`}
                    onClick={() => setToRemove(c)}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length > shown && (
              <button type="button" className="pf-more" onClick={() => setShown(n => n + PAGE)}>
                Mostrar más ({filtered.length - shown} restantes)
              </button>
            )}
          </>
        )}
        <div className="settings-add-cat">
          <button type="button" ref={newCatBtn} className="s-add-cat-btn" onClick={() => setNewCatOpen(true)}>
            <span aria-hidden="true">＋</span> Nueva categoría
          </button>
        </div>
      </Section>
      {/* Portal: .profile-screen tiene transform, que encerraría el position:fixed */}
      {newCatOpen && createPortal(<NewCategoryScreen onClose={closeNewCat} />, document.body)}

      <Section title="Categorías por defecto">
        <p className="s-note s-note--top">
          Ocultar una categoría solo quita la opción de elegirla en movimientos nuevos y pendientes.
          Los movimientos ya guardados no cambian. Siempre queda al menos una visible por tipo.
        </p>
        <div className="s-hidden-head">
          <span className="s-value-text" aria-live="polite">
            {hiddenCount === 0 ? 'Ninguna oculta' : `${hiddenCount} ${hiddenCount === 1 ? 'oculta' : 'ocultas'}`}
          </span>
          <button type="button" className="s-action-btn s-touch" onClick={showAllCategories} disabled={hiddenCount === 0}>
            Mostrar todas
          </button>
        </div>
        {TYPES.map(t => {
          const isOpen = !!open[t.id]
          const hid = hiddenIn(t.id)
          const panelId = `pf-defcats-${t.id.replace(/\W/g, '')}`
          return (
            <div key={t.id} role="group" aria-label={`Categorías de ${TIPO_LABEL[t.id].toLowerCase()}`}>
              <button
                type="button"
                className="pf-disclosure"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(o => ({ ...o, [t.id]: !o[t.id] }))}
              >
                <span className="pf-disclosure-title">{TIPO_PLURAL[t.id]}</span>
                <span className="pf-disclosure-meta">{hid > 0 ? `${hid} ${hid === 1 ? 'oculta' : 'ocultas'}` : `${DEFAULT_CATEGORIES[t.id].length}`}</span>
                <svg className={`pf-chev pf-chev--down${isOpen ? ' open' : ''}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
              <div id={panelId} hidden={!isOpen}>
                {isOpen && DEFAULT_CATEGORIES[t.id].map(c => {
                  const k = categoryKey(t.id, c.concepto)
                  const hidden = hiddenKeys.has(k)
                  const lastOne = !hidden && visibleLeft(t.id, k) < 1
                  return (
                    <Fragment key={k}>
                      <div className={`s-defcat-row${hidden ? ' is-hidden' : ''}`}>
                        <span className="s-defcat-name"><span aria-hidden="true">{c.emoji}</span> {c.concepto}</span>
                        <button
                          type="button"
                          className="s-action-btn s-touch"
                          onClick={() => toggleDefaultCategory(t.id, c.concepto)}
                          disabled={lastOne}
                          aria-pressed={hidden}
                          aria-label={`${hidden ? 'Mostrar' : 'Ocultar'} la categoría ${c.concepto}`}
                          aria-describedby={lastOne ? `s-last-${t.id.replace(/\W/g, '')}` : undefined}
                          title={lastOne ? LAST_VISIBLE_MSG : undefined}
                        >
                          {hidden ? 'Mostrar' : 'Ocultar'}
                        </button>
                      </div>
                      {lastOne && <p className="s-defcat-note" id={`s-last-${t.id.replace(/\W/g, '')}`}>{LAST_VISIBLE_MSG}</p>}
                    </Fragment>
                  )
                })}
              </div>
            </div>
          )
        })}
      </Section>

      {toRemove && (
        <ConfirmSheet
          title={`¿Eliminar la categoría «${toRemove.concepto}»?`}
          message="Las transacciones ya guardadas con ella no cambian, pero dejará de aparecer para elegirla en nuevos movimientos."
          confirmLabel="Eliminar"
          onConfirm={() => { removeCategory(toRemove.tipo, toRemove.concepto); setToRemove(null) }}
          onCancel={() => setToRemove(null)}
        />
      )}
    </>
  )
}
