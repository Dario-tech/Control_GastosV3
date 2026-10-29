// iOS a veces coloca la web dentro de la zona segura y declara env(safe-area-inset-top) = 0
// aunque la hora y la isla se pinten sobre el contenido (Safari, Chrome y PWA). Entonces la
// cabecera quedaba bajo la isla. Si el móvil es un iPhone con muesca/isla (por tamaño de pantalla)
// y el sistema declara 0, se reserva un mínimo seguro. Con un valor real no se toca nada.
export function safeTopFloor({ declared, screenW, screenH, ua, touch }) {
  if (declared > 0) return 0
  if (!touch || !/iPhone/.test(ua || '')) return 0
  const h = Math.max(screenW, screenH)
  if (h >= 926) return 59      // 14 Pro Max, 15/16 y superiores (isla)
  if (h >= 852) return 54      // 14 Pro, 15, 16 (isla)
  if (h >= 812) return 47      // X, 11 Pro, 12/13 (muesca)
  return 0                     // SE y 6/7/8: sin muesca
}
