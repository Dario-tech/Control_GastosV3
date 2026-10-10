import { createContext, useContext, useState, useCallback } from 'react'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [activeTab, setActiveTab] = useState('year')
  const [toast, setToast] = useState(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
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
      toast, showToast,
      goToMonth,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
