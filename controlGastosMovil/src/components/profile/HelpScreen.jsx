import { useEffect, useMemo, useState } from 'react'
import { Section, Row } from './ui'
import { currentInstallContext, installSteps } from '../../utils/installContext'

const SUPPORT_EMAIL_DISPLAY = 'soporte@mieconomia.app'
const SUPPORT_EMAIL_REAL    = 'marioomc00@gmail.com'

// Instalar como app: pasos según sistema y navegador; en Android/Chrome, además, el botón nativo.
function InstallSection() {
  const ctx = useMemo(() => currentInstallContext(), [])
  const [prompt, setPrompt] = useState(null)
  useEffect(() => {
    const onPrompt = e => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])
  if (ctx.installed) return null
  const where = ctx.platform === 'ios' ? 'iPhone' : ctx.platform === 'android' ? 'Android' : 'este dispositivo'
  return (
    <Section title="Instalar como app">
      <p className="s-note s-note--top">Estás en el navegador. Instalada ({where}) se abre a pantalla completa y como una app más.</p>
      {prompt && (
        <button type="button" className="pf-row pf-nav-row" onClick={async () => { await prompt.prompt(); setPrompt(null) }}>
          <span className="pf-row-left"><span className="pf-row-icon" aria-hidden="true">📲</span><span className="pf-row-label">Instalar ahora</span></span>
        </button>
      )}
      <ol className="s-note" style={{ margin: 0, padding: '0 16px 14px 36px' }}>
        {installSteps(ctx).map(t => <li key={t}>{t}</li>)}
      </ol>
    </Section>
  )
}

export default function HelpScreen({ onShowGuide }) {
  return (
    <>
      <InstallSection />
      {onShowGuide && (
        <Section title="Guía">
          <button type="button" className="pf-row pf-nav-row last" onClick={onShowGuide}>
            <span className="pf-row-left">
              <span className="pf-row-icon" aria-hidden="true">📖</span>
              <span className="pf-row-label">Ver guía de la app</span>
            </span>
            <span className="pf-row-right">
              <svg className="pf-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </span>
          </button>
        </Section>
      )}
      <Section title="Soporte">
        <p className="s-note s-note--top">¿Tienes dudas o algo no funciona? Escríbenos.</p>
        <Row icon="✉️" label="Contacto" last wrap>
          <a
            className="s-value-text s-link pf-link"
            href={`mailto:${SUPPORT_EMAIL_REAL}?subject=${encodeURIComponent('Ayuda con Mi Economía')}`}
          >
            {SUPPORT_EMAIL_DISPLAY}
          </a>
        </Row>
      </Section>
    </>
  )
}
