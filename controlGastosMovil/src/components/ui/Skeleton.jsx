// Esqueletos de cristal para los fallbacks de React.lazy / Suspense.
// Solo usan variables del tema, así que se ven bien en los 7 temas.

export function SkeletonBlock({ className = '' }) {
  return <div className={`skel ${className}`} aria-hidden="true" />
}

// Fallback de una pestaña entera (Mes, Stats, Planificación).
export function TabSkeleton() {
  return (
    <div className="tab-panel" role="status" aria-busy="true" aria-label="Cargando">
      <SkeletonBlock className="skel-hero" />
      <SkeletonBlock className="skel-card" />
      <SkeletonBlock className="skel-card skel-card--short" />
    </div>
  )
}

// Fallback de un formulario a pantalla completa mientras baja su código.
export function FormSkeleton() {
  return (
    <div className="fm-screen skel-screen" role="status" aria-busy="true" aria-label="Cargando formulario">
      <SkeletonBlock className="skel-back" />
      <SkeletonBlock className="skel-title" />
      <SkeletonBlock className="skel-card" />
      <SkeletonBlock className="skel-card skel-card--short" />
    </div>
  )
}

// Fallback de un gráfico dentro de su tarjeta.
export function ChartSkeleton({ height = 180 }) {
  return <div className="skel skel-chart" style={{ height }} role="status" aria-busy="true" aria-label="Cargando gráfico" />
}
