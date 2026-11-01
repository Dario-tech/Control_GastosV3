import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import './App.css'
import App from './App'
import DiagScreen from './components/ui/DiagScreen' // ?diag=1 (quitable)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('diag') === '1' ? <DiagScreen /> : <App />}
  </StrictMode>
)
