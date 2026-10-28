import { useEffect, useRef, useState } from 'react'

// Pantalla de diagnóstico de viewport y zonas seguras (?diag=1). No carga datos
// ni pide sesión; se monta desde main.jsx en lugar de la app. Para quitarla:
// borrar este fichero y las tres líneas de main.jsx que la mencionan.
const px = v => (v == null || Number.isNaN(v) ? 'n/d' : `${Math.round(v * 100) / 100}px`)
const rect = el => {
  if (!el) return 'no existe en esta pantalla'
  const r = el.getBoundingClientRect()
  return `top ${px(r.top)}  bottom ${px(r.bottom)}  left ${px(r.left)}  w ${px(r.width)}  h ${px(r.height)}`
}
const hOf = sel => { const e = document.querySelector(sel); return e ? px(e.getBoundingClientRect().height) : 'n/d' }

export function medir(doc = document, win = window) {
  const probe = doc.querySelector('.diag-probe')
  const cs = probe ? win.getComputedStyle(probe) : null
  const vv = win.visualViewport
  const ua = (win.navigator.userAgent || '').match(/(iPhone|iPad|Android|Mac OS X|Windows)[^;)]*|Version\/[\d.]+|CriOS\/[\d.]+|Chrome\/[\d.]+/g)
  const mm = q => (win.matchMedia ? win.matchMedia(q).matches : false)
  return [
    `innerWidth x innerHeight: ${win.innerWidth} x ${win.innerHeight}`,
    `screen.width x height: ${win.screen.width} x ${win.screen.height}`,
    `visualViewport: ${vv ? `${px(vv.width)} x ${px(vv.height)}, offsetTop ${px(vv.offsetTop)}` : 'n/d'}`,
    `documentElement.clientHeight: ${doc.documentElement.clientHeight}`,
    `safe-top (env): ${cs ? cs.paddingTop : 'n/d'}   safe-bottom (env): ${cs ? cs.paddingBottom : 'n/d'}`,
    `--safe-top / --safe-bottom (CSS): ${win.getComputedStyle(doc.documentElement).getPropertyValue('--safe-top').trim()} / ${win.getComputedStyle(doc.documentElement).getPropertyValue('--safe-bottom').trim()}`,
    `alturas CSS: 100vh ${hOf('.diag-h-vh')}  100dvh (= .app) ${hOf('.diag-h-dvh')}  100lvh ${hOf('.diag-h-lvh')}  100svh ${hOf('.diag-h-svh')}  100% ${hOf('.diag-h-pct')}`,
    `#root: ${hOf('#root')}   body: ${hOf('body')}   html: ${hOf('html')}   .app: ${hOf('.app')}`,
    `display-mode standalone: ${mm('(display-mode: standalone)')}   navigator.standalone: ${String(win.navigator.standalone)}`,
    `devicePixelRatio: ${win.devicePixelRatio}`,
    `UA: ${ua ? ua.join(' | ') : win.navigator.userAgent}`,
    `.header: ${rect(doc.querySelector('.header'))}`,
    `.bottom-nav: ${rect(doc.querySelector('.bottom-nav'))}`,
  ].join('\n')
}

export default function DiagScreen() {
  const [texto, setTexto] = useState('')
  const [copiado, setCopiado] = useState(false)
  const ref = useRef(null)
  const medirYa = () => setTexto(medir())
  useEffect(() => {
    medirYa()
    window.addEventListener('resize', medirYa)
    window.visualViewport?.addEventListener('resize', medirYa)
    return () => {
      window.removeEventListener('resize', medirYa)
      window.visualViewport?.removeEventListener('resize', medirYa)
    }
  }, [])
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto) }
    catch {
      const t = document.createElement('textarea')
      t.value = texto; document.body.appendChild(t); t.select()
      try { document.execCommand('copy') } catch { /* sin portapapeles */ }
      t.remove()
    }
    setCopiado(true); setTimeout(() => setCopiado(false), 1500)
  }
  return (
    <div className="diag" ref={ref}>
      <div className="diag-probe" aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} />
      {[['vh', '100vh'], ['dvh', '100dvh'], ['lvh', '100lvh'], ['svh', '100svh'], ['pct', '100%']].map(([k, h]) => (
        <div key={k} className={`diag-h-${k}`} style={{ position: 'fixed', left: 0, width: 1, top: 0, height: h, visibility: 'hidden' }} />
      ))}
      <div className="diag-band top">ROJO: top:0 del viewport fijo</div>
      <div className="diag-band bottom">AZUL: bottom:0 del viewport fijo</div>
      <div className="diag-side l" /><div className="diag-side r" />
      <div className="diag-lvh" />
      <h1>Diagnóstico de pantalla</h1>
      <div>
        <button onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</button>
        <button onClick={medirYa}>Medir de nuevo</button>
      </div>
      <pre>{texto}</pre>
      <pre>{`Rojo = borde superior, azul = borde inferior, verde/rosa = laterales, marco amarillo = 100lvh. Si el azul no llega al borde físico de la pantalla, la página no pinta ahí.`}</pre>
    </div>
  )
}
