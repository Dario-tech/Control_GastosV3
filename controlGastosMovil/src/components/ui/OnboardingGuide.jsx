import { useState } from 'react'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'

export const ONBOARDING_LS_KEY = 'mi-economia-onboarding-v1'

export function shouldShowOnboarding() {
  try { return !localStorage.getItem(ONBOARDING_LS_KEY) } catch { return false }
}

export function markOnboardingSeen() {
  try { localStorage.setItem(ONBOARDING_LS_KEY, new Date().toISOString()) } catch {}
}

const SLIDES = [
  {
    emoji: '👋',
    title: 'Bienvenido a Mi Economía',
    body: 'Tu app para controlar gastos, ingresos y ahorro. Te enseñamos lo básico en menos de un minuto.',
  },
  {
    emoji: '➕',
    title: 'Registra tus movimientos',
    body: 'Con el botón + de arriba añades gastos e ingresos en segundos: importe, categoría, fecha y, si quieres, un comentario para recordar de qué era.',
  },
  {
    emoji: '📊',
    title: 'Todo tu año de un vistazo',
    body: 'La pestaña Año muestra tu balance acumulado. En Mes ves el detalle de cada mes con su calendario de actividad, y en Stats las tendencias de tus gastos.',
  },
  {
    emoji: '🎯',
    title: 'Presupuestos con alertas',
    body: 'En la pestaña Presupuesto pones un límite mensual por categoría. La app calcula sola cuánto llevas gastado y te avisa si te acercas al límite.',
  },
  {
    emoji: '🤝',
    title: 'Metas de ahorro compartidas',
    body: 'Crea metas de ahorro y compártelas con otra persona: los dos podéis añadir dinero, e incluso adjuntar fotos para crear un álbum de recuerdos. Puedes volver a ver esta guía desde tu perfil.',
  },
]

export default function OnboardingGuide({ onFinish }) {
  useLockBodyScroll()
  const [index, setIndex] = useState(0)
  const isLast = index === SLIDES.length - 1
  const slide  = SLIDES[index]

  function finish() {
    markOnboardingSeen()
    onFinish()
  }

  return (
    <div className="onboarding-overlay">
      <button className="onboarding-skip" onClick={finish}>Saltar</button>

      <div className="onboarding-slide" key={index}>
        <div className="onboarding-emoji">{slide.emoji}</div>
        <h2 className="onboarding-title">{slide.title}</h2>
        <p className="onboarding-body">{slide.body}</p>
      </div>

      <div className="onboarding-footer">
        <div className="onboarding-dots">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={`onboarding-dot${i === index ? ' active' : ''}`}
              onClick={() => setIndex(i)}
              aria-label={`Paso ${i + 1}`}
            />
          ))}
        </div>
        <div className="onboarding-nav">
          {index > 0 && (
            <button className="onboarding-back" onClick={() => setIndex(index - 1)}>Atrás</button>
          )}
          <button
            className="onboarding-next"
            onClick={() => (isLast ? finish() : setIndex(index + 1))}
          >
            {isLast ? '¡Empezar!' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  )
}
