import { useId } from 'react'

export function GoalIcon({ goal, className }) {
  if (goal.imagen_url) return <img className={className} src={goal.imagen_url} alt={goal.nombre} />
  return <span className={className}>{goal.emoji}</span>
}

// Anillo de progreso (SVG). pathLength=100 -> el desplazamiento es directamente el % restante.
export function GoalRing({ pct, done, size = 'md', children }) {
  const gid = useId()
  return (
    <div className={`goal-ring goal-ring--${size}${done ? ' done' : ''}`} style={{ '--off': 100 - pct }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   className="goal-ring-stop-a" />
            <stop offset="100%" className="goal-ring-stop-b" />
          </linearGradient>
        </defs>
        <circle className="goal-ring-track" cx="50" cy="50" r="42" pathLength="100" />
        {pct > 0 && (
          <circle className="goal-ring-fg" cx="50" cy="50" r="42" pathLength="100" stroke={`url(#${gid})`} />
        )}
      </svg>
      <div className="goal-ring-center">{children}</div>
    </div>
  )
}
