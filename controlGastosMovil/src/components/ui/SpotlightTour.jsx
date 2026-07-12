import { useState, useEffect, useRef } from 'react'

// Tour interactivo tipo "spotlight": la pantalla se oscurece y solo queda
// iluminado el elemento real que se está enseñando. El usuario avanza tocando
// ese elemento (el clic atraviesa la capa solo en la zona iluminada y ejecuta
// la acción real de la app); el resto de la pantalla queda bloqueado.
export const TOUR_LS_KEY = 'mi-economia-tour-v1'

export function shouldShowTour() {
  try { return !localStorage.getItem(TOUR_LS_KEY) } catch { return false }
}

export function markTourSeen() {
  try { localStorage.setItem(TOUR_LS_KEY, new Date().toISOString()) } catch {}
}

const STEPS = [
  {
    target: '[data-tour="add"]',
    text: 'Toca el botón + para registrar un gasto o un ingreso: importe, categoría, fecha y un comentario si quieres.',
    advance: 'click',
    waitModal: true, // se abre el modal real; el tour espera a que lo cierres
  },
  {
    target: '[data-tour="tab-month"]',
    text: 'Toca la pestaña Mes: ahí ves el detalle de cada mes con su calendario de actividad.',
    advance: 'click',
  },
  {
    target: '[data-tour="tab-stats"]',
    text: 'Toca Stats para ver las tendencias de tus gastos.',
    advance: 'click',
  },
  {
    target: '[data-tour="tab-budget"]',
    text: 'Toca Presupuesto: ahí pones límites de gasto por categoría y la app te avisa si te acercas.',
    advance: 'click',
  },
  {
    target: '[data-tour="goals"]',
    text: 'Estas son tus metas de ahorro: créalas, compártelas con otra persona y añadid dinero con fotos de recuerdo.',
    advance: 'next',
  },
  {
    target: '[data-tour="profile"]',
    text: 'Desde tu perfil puedes repetir esta guía cuando quieras. ¡Listo, a controlar tus gastos!',
    advance: 'next',
    lastLabel: '¡Terminar!',
  },
]

const PAD = 10 // aire entre el elemento y el borde del círculo

export default function SpotlightTour({ onFinish, modalOpen }) {
  const [stepIdx, setStepIdx]           = useState(0)
  const [rect, setRect]                 = useState(null)
  const [waitingModal, setWaitingModal] = useState(false)
  const modalWasOpen = useRef(false)
  const step = STEPS[stepIdx]

  function finish() {
    markTourSeen()
    onFinish()
  }

  function next() {
    if (stepIdx + 1 >= STEPS.length) { finish(); return }
    setRect(null)
    setWaitingModal(false)
    setStepIdx(stepIdx + 1)
  }

  // Localiza el elemento del paso (esperando a que exista: al cambiar de
  // pestaña tarda un render), hace scroll hasta él y sigue su posición ante
  // resize, scroll o cambios de layout.
  useEffect(() => {
    let el = null
    let scrolled = false

    function measure() {
      if (!el || !document.contains(el)) el = document.querySelector(step.target)
      if (!el) return
      if (!scrolled) {
        scrolled = true
        el.scrollIntoView({ block: 'center', behavior: 'auto' })
      }
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return
      setRect(prev =>
        prev && prev.x === r.left && prev.y === r.top && prev.w === r.width && prev.h === r.height
          ? prev
          : { x: r.left, y: r.top, w: r.width, h: r.height }
      )
    }

    measure()
    const interval = setInterval(measure, 250)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [stepIdx])

  // Pasos interactivos: detecta el clic real sobre el elemento señalado.
  useEffect(() => {
    if (step.advance !== 'click') return
    function onClick(e) {
      const el = document.querySelector(step.target)
      if (!el || !el.contains(e.target)) return
      if (step.waitModal) setWaitingModal(true)
      else setTimeout(next, 200) // pequeño margen para que la acción real termine de renderizar
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [stepIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Paso con modal (botón +): el tour se oculta mientras el modal real está
  // abierto y avanza cuando el usuario lo cierra.
  useEffect(() => {
    if (!waitingModal) return
    if (modalOpen) {
      modalWasOpen.current = true
    } else if (modalWasOpen.current) {
      modalWasOpen.current = false
      next()
    }
  }, [modalOpen, waitingModal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mientras el modal real está abierto, el tour desaparece por completo.
  if (waitingModal && (modalOpen || modalWasOpen.current)) return null

  const vw = window.innerWidth
  const vh = window.innerHeight

  const hole = rect
    ? {
        left:   rect.x - PAD,
        top:    rect.y - PAD,
        width:  rect.w + PAD * 2,
        height: rect.h + PAD * 2,
      }
    : null

  // Círculo/óvalo para elementos pequeños; rectángulo redondeado para bloques anchos.
  const holeRadius = hole && hole.width > 200 ? '20px' : '50%'

  // El cuadro de texto va debajo del hueco si hay sitio; si no, encima.
  const tipBelow = hole ? hole.top + hole.height + 170 < vh : true
  const tipStyle = hole
    ? tipBelow
      ? { top: hole.top + hole.height + 18 }
      : { bottom: vh - hole.top + 18 }
    : { top: '40%' }

  const isLast = stepIdx === STEPS.length - 1

  return (
    <div className="tour-root">
      {hole ? (
        <>
          {/* Oscurecimiento + halo: puramente visual, deja pasar los toques */}
          <div
            className="tour-hole"
            style={{
              left: hole.left, top: hole.top, width: hole.width, height: hole.height,
              borderRadius: holeRadius,
            }}
          />
          {/* Bloqueo de todo lo que queda fuera del hueco */}
          <div className="tour-block" style={{ left: 0, top: 0, width: '100vw', height: Math.max(0, hole.top) }} />
          <div className="tour-block" style={{ left: 0, top: hole.top + hole.height, width: '100vw', height: Math.max(0, vh - hole.top - hole.height) }} />
          <div className="tour-block" style={{ left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height }} />
          <div className="tour-block" style={{ left: hole.left + hole.width, top: hole.top, width: Math.max(0, vw - hole.left - hole.width), height: hole.height }} />
          {/* En pasos informativos el hueco tampoco es clicable */}
          {step.advance !== 'click' && (
            <div className="tour-block" style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }} />
          )}
        </>
      ) : (
        // El elemento aún no existe (cambio de pestaña en curso): bloquear todo
        <div className="tour-block tour-block--full" />
      )}

      <div className="tour-tip" style={tipStyle}>
        <p className="tour-tip-text">{step.text}</p>
        <div className="tour-tip-footer">
          <button className="tour-skip" onClick={finish}>Saltar tour</button>
          <span className="tour-progress">{stepIdx + 1} / {STEPS.length}</span>
          {step.advance === 'next' ? (
            <button className="tour-next-btn" onClick={next}>
              {isLast ? (step.lastLabel ?? '¡Terminar!') : 'Siguiente'}
            </button>
          ) : (
            <span className="tour-hint">👆 Toca el círculo</span>
          )}
        </div>
      </div>
    </div>
  )
}
