export default function KpiCard({ label, value, sub, accent, small }) {
  return (
    <div className={`kpi-card ${accent ? `kpi-${accent}` : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${small ? 'kpi-value--sm' : ''}`}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  )
}
