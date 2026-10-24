import { createContext, useContext, useState, useCallback } from 'react'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [activeTab, setActiveTab] = useState('year')
  const [toast, setToast] = useState(null)
  const [toastIsError, setToastIsError] = useState(false)

  // `opts.error` marca el aviso como error (role="alert" para lectores de pantalla).
  const showToast = useCallback((msg, opts) => {
    setToast(msg)
    setToastIsError(!!opts?.error)
    setTimeout(() => setToast(null), opts?.error ? 4500 : 2500)
  }, [])

  const goToMonth = useCallback((monthIndex, year) => {
    setSelectedMonth(monthIndex)
    if (year) setSelectedYear(year)
    setActiveTab('month')
  }, [])

  return (
    <AppContext.Provider value={{
      selectedMonth, setSelectedMonth,
      selectedYear, setSelectedYear,
      activeTab, setActiveTab,
      toast, toastIsError, showToast,
      goToMonth,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
