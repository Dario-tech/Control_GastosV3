// Estado del tour guiado (si ya se ha visto), separado de SpotlightTour para
// poder decidir si mostrarlo sin cargar el componente.
export const TOUR_LS_KEY = 'mi-economia-tour-v1'

export function shouldShowTour() {
  try { return !localStorage.getItem(TOUR_LS_KEY) } catch { return false }
}

export function markTourSeen() {
  try { localStorage.setItem(TOUR_LS_KEY, new Date().toISOString()) } catch {}
}
