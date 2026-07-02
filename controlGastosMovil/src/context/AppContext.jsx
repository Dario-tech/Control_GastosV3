import { createContext, useContext, useState, useCallback } from 'react'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [activeTab, setActiveTab] = useState('year')
  const [toast, setToast] = useState(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])

  const goToMonth = useCallback((monthIndex) => {
    setSelectedMonth(monthIndex)
    setActiveTab('month')
  }, [])

  return (
    <AppContext.Provider value={{
      selectedMonth, setSelectedMonth,
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
