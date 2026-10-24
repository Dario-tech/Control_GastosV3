import { useApp } from '../../context/AppContext'

// La región vive siempre en el DOM (vacía cuando no hay aviso) para que los
// lectores de pantalla anuncien el texto cuando aparece.
export default function Toast() {
  const { toast, toastIsError } = useApp()
  return (
    <div
      className={`toast ${toast ? 'show' : ''}`}
      role={toastIsError ? 'alert' : 'status'}
      aria-live={toastIsError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {toast}
    </div>
  )
}
