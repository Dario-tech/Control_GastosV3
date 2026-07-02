import { useFinanceData } from '../../context/FinanceDataContext'

export default function Header() {
  const { data } = useFinanceData()

  return (
    <header className="header">
      <div className="header-title-block">
        <h1 className="header-title">Mi Economía</h1>
        <span className="header-sub">Resumen {data?.year ?? new Date().getFullYear()}</span>
      </div>
    </header>
  )
}
