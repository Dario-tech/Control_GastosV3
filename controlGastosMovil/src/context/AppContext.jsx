import { createContext, useContext, useState, useCallback } from 'react'
import { getActiveMonths } from '../utils'
import { DATA as MOCK_DATA } from '../data/mockData'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const active = getActiveMonths(MOCK_DATA)
  const lastActive = active[active.length - 1]?.index ?? 0
  const [selectedMonth, setSelectedMonth] = useState(lastActive)
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
