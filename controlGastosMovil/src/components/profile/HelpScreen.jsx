import { Section, Row } from './ui'

const SUPPORT_EMAIL_DISPLAY = 'soporte@mieconomia.app'
const SUPPORT_EMAIL_REAL    = 'marioomc00@gmail.com'

export default function HelpScreen({ onShowGuide }) {
  return (
    <>
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
