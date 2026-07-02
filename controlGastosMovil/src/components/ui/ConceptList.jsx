import { fmt } from '../../utils'

export default function ConceptList({ items, monthIndex, colorClass = 'expense-amt', onSelect }) {
  const filtered = items.filter(i => (i.amounts[monthIndex] || 0) > 0)

  if (filtered.length === 0) {
    return <p className="empty-msg">Sin registros este mes</p>
  }

  return (
    <ul className="concept-list">
      {filtered.map(item => (
        <li
          key={item.concept}
          className={onSelect ? 'concept-clickable' : ''}
          onClick={() => onSelect?.(item)}
        >
          <span className="concept-icon-wrap">{item.emoji}</span>
          <span className="concept-name">{item.concept}</span>
          <span className={`concept-amount ${colorClass}`}>
            {fmt(item.amounts[monthIndex])}
          </span>
          {onSelect && <span className="concept-chevron">›</span>}
        </li>
      ))}
    </ul>
  )
}
