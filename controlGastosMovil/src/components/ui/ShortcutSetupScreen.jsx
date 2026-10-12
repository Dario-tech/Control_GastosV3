import { useEffect, useRef, useState } from 'react'
import { FormScreen } from './FormKit'

/* Guía para montar a mano, en la app Atajos de iOS, la automatización
   "Transacción" de Cartera. El Atajo solo abre la app con el importe y el
   comercio en la URL (?atajo=1&importe=…&comercio=…); la app, con la sesión
   ya iniciada, crea el pendiente y pide confirmarlo. Sin claves ni tokens.
   La PWA no puede leer Cartera ni instalar automatizaciones: solo guía. */

// Base del enlace del Atajo: el ORIGEN REAL donde corre la app (no la API).
export function shortcutLinkBase(origin = window.location.origin) {
  return `${origin}/?atajo=1`
}

// Enlace de prueba: simula lo que mandaría el Atajo tras un pago de 1 €.
export function shortcutTestLink(origin = window.location.origin) {
  return `${shortcutLinkBase(origin)}&importe=${encodeURIComponent('1,00 €')}&comercio=Prueba`
}

function StepHead({ n, title }) {
  return (
    <div className="sc-step-head">
      <span className="sc-step-num" aria-hidden="true">{n}</span>
      <h2 className="sc-step-title" id={`sc-step-${n}`}><span className="sr-only">Paso {n}: </span>{title}</h2>
    </div>
  )
}

// Bloque que imita una acción de la app Atajos (icono de color + nombre + campos).
function ActionBlock({ n, icon, tone = 'accent', name, children }) {
  return (
    <div className={`sc-action sc-action--${tone}`}>
      <div className="sc-action-head">
        <span className="sc-action-icon" aria-hidden="true">{icon}</span>
        <span className="sc-action-name"><span className="sc-action-n">{n}.</span> {name}</span>
      </div>
      {children && <div className="sc-action-body">{children}</div>}
    </div>
  )
}

function ActionRow({ k, v }) {
  return (
    <div className="sc-action-row">
      <span className="sc-action-k">{k}</span>
      <span className="sc-action-v">{v}</span>
    </div>
  )
}

// Ficha que representa una variable de Atajos (las "pastillas" azules).
const Var = ({ children }) => <span className="sc-var">{children}</span>

export default function ShortcutSetupScreen({ onClose, navigate = url => window.location.assign(url) }) {
  const link = shortcutLinkBase()
  const [copied, setCopied]         = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopyFailed(false)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
    }
  }

  return (
    <FormScreen title="Pagos automáticos (iPhone)" label="Configurar pagos automáticos con Apple Pay" onClose={onClose}
      subtitle="Cada vez que pagues con Apple Pay, se abrirá la app con el gasto ya rellenado para que lo guardes con un toque.">

      {/* Qué hace y límites */}
      <section className="fm-card sc-intro" aria-label="Cómo funciona">
        <div className="sc-phone" aria-hidden="true">
          <div className="sc-phone-notch" />
          <div className="sc-phone-notif">
            <span className="sc-phone-app">💶</span>
            <span className="sc-phone-text">
              <strong>Gasto recibido</strong>
              <span>12,40 € · Mercadona</span>
            </span>
          </div>
          <div className="sc-phone-cta">Guardar</div>
        </div>
        <ul className="sc-list">
          <li>Pagas con Apple Pay → el iPhone abre la app → ves el gasto con su categoría sugerida → <strong>Guardar</strong>.</li>
          <li>Solo funciona con <strong>Apple Pay del iPhone</strong>. No con la tarjeta física ni con compras por internet.</li>
          <li>A veces iOS no avisa. Lo que falte, añádelo a mano como siempre.</li>
          <li>Necesitas iOS 17 o posterior.</li>
        </ul>
      </section>

      {/* Aviso Safari */}
      <section className="sc-tip sc-tip--warn" aria-label="Importante: Safari">
        <span aria-hidden="true">⚠️</span>
        <p>
          <strong>Importante:</strong> el iPhone abre el enlace en <strong>Safari</strong>, no en la app de la pantalla
          de inicio. Entra una vez en <strong>{window.location.host}</strong> desde Safari e inicia sesión (dura 30 días).
          Si sueles usar la app instalada, no pasa nada: el gasto también se guarda desde Safari.
        </p>
      </section>

      {/* Paso 1 */}
      <section className="fm-card sc-step" aria-labelledby="sc-step-1">
        <StepHead n={1} title="Copia el enlace" />
        <div className="sc-copy">
          <span className="sc-copy-label">Enlace del atajo</span>
          <code className="sc-copy-value" data-testid="sc-link">{link}</code>
          <button type="button" className="shortcut-token-copy sc-copy-btn" onClick={copyLink}>
            {copied ? '✓ Copiado' : 'Copiar enlace del atajo'}
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{copied ? 'Copiado' : ''}</p>
        {copyFailed && (
          <p className="sc-warn" role="alert">No se pudo copiar automáticamente. Mantén pulsado el enlace para copiarlo.</p>
        )}
      </section>

      {/* Paso 2 */}
      <section className="fm-card sc-step" aria-labelledby="sc-step-2">
        <StepHead n={2} title="Crea el Atajo" />
        <ol className="sc-sublist">
          <li>Abre la app <strong>Atajos</strong>, pestaña <strong>Atajos</strong>, y toca <strong>+</strong>.</li>
          <li>Ponle de nombre <strong>Mi Economía</strong>.</li>
          <li>Añade estas acciones, en este orden:</li>
        </ol>

        <div className="sc-actions" aria-label="Acciones del Atajo">
          <ActionBlock n={1} icon="💳" tone="accent" name="Recibir entrada">
            <ActionRow k="Recibir" v={<><strong>Transacciones</strong> de <strong>Cartera</strong></>} />
            <p className="sc-hint">Suele aparecer arriba del todo al tocar el atajo (ⓘ → «Recibir»).</p>
          </ActionBlock>

          <ActionBlock n={2} icon="🔤" tone="orange" name="Codificar URL">
            <ActionRow k="Codificar" v={<><Var>Entrada del atajo</Var> → <strong>Comercio</strong></>} />
            <p className="sc-hint">Toca la variable y elige <strong>Comercio</strong>. Así funcionan nombres con espacios o acentos.</p>
          </ActionBlock>

          <ActionBlock n={3} icon="🔤" tone="orange" name="Codificar URL">
            <ActionRow k="Codificar" v={<><Var>Entrada del atajo</Var> → <strong>Importe</strong></>} />
          </ActionBlock>

          <ActionBlock n={4} icon="📝" tone="green" name="Texto">
            <p className="sc-text sc-text-build">
              Pega el enlace y añade detrás, sin espacios:
            </p>
            <code className="sc-formula">
              {link}<wbr />&amp;importe=<Var>resultado de Codificar URL 3</Var><wbr />&amp;comercio=<Var>resultado de Codificar URL 2</Var>
            </code>
            <p className="sc-hint">Las fichas azules se insertan tocando <strong>Variable</strong> encima del teclado y eligiendo el resultado de cada «Codificar URL».</p>
          </ActionBlock>

          <ActionBlock n={5} icon="🧭" tone="red" name="Abrir URLs">
            <ActionRow k="Abrir" v={<Var>Texto</Var>} />
          </ActionBlock>
        </div>
      </section>

      {/* Paso 3 */}
      <section className="fm-card sc-step" aria-labelledby="sc-step-3">
        <StepHead n={3} title="Crea la automatización" />
        <ol className="sc-sublist">
          <li>En Atajos, pestaña <strong>Automatización</strong> → <strong>Nueva automatización</strong> (o <strong>+</strong>).</li>
          <li>Elige <strong>Transacción</strong>.</li>
          <li>Marca tus tarjetas de Cartera (puedes dejar todas las categorías).</li>
          <li>Elige <strong>Ejecutar inmediatamente</strong> (no «Ejecutar tras confirmación»).</li>
          <li>Toca <strong>Siguiente</strong> y elige el atajo <strong>Mi Economía</strong>.</li>
        </ol>
      </section>

      {/* Paso 4 */}
      <section className="fm-card sc-step" aria-labelledby="sc-step-4">
        <StepHead n={4} title="Pruébalo" />
        <p className="sc-text">
          Mira cómo queda sin pagar nada: «Probar ahora» abre la app como si hubieras pagado 1,00 € en «Prueba».
          Luego puedes descartarlo.
        </p>
        <button type="button" className="fm-secondary fm-secondary--wide" onClick={() => navigate(shortcutTestLink())}>
          Probar ahora
        </button>
        <p className="sc-hint">
          Después, paga algo pequeño con Apple Pay. ¿No se abre la app? Revisa que la automatización esté en
          «Ejecutar inmediatamente» y que la acción «Texto» empiece por {link}.
        </p>
      </section>
    </FormScreen>
  )
}
