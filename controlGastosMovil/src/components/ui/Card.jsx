export default function Card({ title, children, noPad }) {
  return (
    <div className="card">
      {title && (
        <div className="card-header">
          <span className="card-title">{title}</span>
        </div>
      )}
      <div className={noPad ? '' : 'card-body'}>
        {children}
      </div>
    </div>
  )
}
