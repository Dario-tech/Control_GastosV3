import { useEffect, useRef, useState } from 'react'
import { FormScreen } from './FormKit'
import { BASE, getShortcutToken } from '../../services/api'

/* Guía para montar a mano, en la app Atajos de iOS, la automatización
   "Transacción" de Cartera. Dos modos:
   - "app" (Abrir la app): el Atajo abre la app con el importe y el comercio en
     la URL (?atajo=1&importe=…&comercio=…); la app, con la sesión iniciada,
     crea el pendiente y pide confirmarlo. Sin claves.
   - "fondo" (En segundo plano): el Atajo manda el pago directo al servidor
     (POST /api/shortcut/pending con la clave personal) y queda PENDIENTE.
   La clave solo se pide al servidor al pulsar el botón y nunca va en el prompt.
   La PWA no puede leer Cartera ni instalar automatizaciones: solo guía. */

// \u003c = «<» (escrito así para no confundir al test de imports que busca etiquetas JSX).
export const KEY_PLACEHOLDER = '\u003cPEGA_AQUI_TU_CLAVE>'

// Base del enlace del Atajo: el ORIGEN REAL donde corre la app (no la API).
export function shortcutLinkBase(origin = window.location.origin) {
  return `${origin}/?atajo=1`
}

// Enlace de prueba: simula lo que mandaría el Atajo tras un pago de 1 €.
export function shortcutTestLink(origin = window.location.origin) {
  return `${shortcutLinkBase(origin)}&importe=${encodeURIComponent('1,00 €')}&comercio=Prueba`
}

// Prompt del modo "Abrir la app": solo lleva el enlace público de la app.
export function buildPromptApp(link = shortcutLinkBase()) {
  return `Quiero crear en la app Atajos de iPhone (iOS 17 o posterior) un atajo llamado «Mi Economía» y una automatización que lo ejecute cada vez que pague con Apple Pay. El atajo abre mi app de gastos con el pago ya rellenado. Explícame o guíame paso a paso, usando los nombres de las acciones en español de iOS.

PARTE 1. CREAR EL ATAJO
En Atajos, pestaña «Atajos», toca «+» y ponle de nombre «Mi Economía». Añade estas acciones, en este orden:

1. Acción «Recibir»: configúrala como «Recibir Transacciones de Cartera» (se ve al tocar la «i» del atajo, en «Recibir»).
2. Acción «Codificar URL»: en el campo de entrada pon la variable «Entrada del atajo» y elige su propiedad «Comercio». Esta acción es «Codificar URL 1».
3. Acción «Codificar URL»: en el campo de entrada pon la variable «Entrada del atajo» y elige su propiedad «Importe». Esta acción es «Codificar URL 2».
4. Acción «Texto»: escribe exactamente, sin espacios ni saltos de línea:
${link}&importe=[Resultado de Codificar URL 2]&comercio=[Resultado de Codificar URL 1]
Los dos textos entre corchetes son variables: se insertan tocando «Variable» encima del teclado y eligiendo el resultado de cada «Codificar URL». No se escriben a mano.
5. Acción «Abrir URLs»: ábrela con la variable «Texto» de la acción anterior.

PARTE 2. CREAR LA AUTOMATIZACIÓN
1. En Atajos, pestaña «Automatización», toca «Nueva automatización» (o «+»).
2. Elige «Transacción» (Cartera).
3. Marca mis tarjetas de Cartera (pueden quedar todas las categorías).
4. Elige «Ejecutar inmediatamente» (NO «Ejecutar tras confirmación»).
5. Toca «Siguiente» y elige el atajo «Mi Economía».

PARTE 3. COMPROBAR
Para probarlo sin pagar, abre en Safari este enlace: ${link}&importe=1%2C00%20%E2%82%AC&comercio=Prueba
Debe abrirse la app con un pago de 1,00 € en «Prueba».

Notas: el enlace se abre en Safari, así que tengo que haber iniciado sesión una vez en Safari en esa dirección. Solo funciona con Apple Pay del iPhone. Dime al final qué comprobar si la app no se abre.`
}

// Prompt del modo "En segundo plano". Lleva la URL real de la API y el marcador
// literal de la clave: NUNCA la clave real (el texto puede acabar en una IA ajena).
export function buildPromptBackground(api = BASE) {
  const url = `${api}/api/shortcut/pending`
  return `Quiero crear en la app Atajos de iPhone (iOS 17 o posterior) un atajo llamado «Mi Economía (segundo plano)» y una automatización que lo ejecute cada vez que pague con Apple Pay. El atajo NO abre ninguna app: manda el pago directamente a mi servidor y queda como PENDIENTE de revisar. Explícame o guíame paso a paso, usando los nombres de las acciones en español de iOS.

PARTE 1. CREAR EL ATAJO
En Atajos, pestaña «Atajos», toca «+» y ponle de nombre «Mi Economía (segundo plano)». Añade estas acciones, en este orden:

1. Acción «Recibir»: configúrala como «Recibir Transacciones de Cartera».
2. Acción «Texto»: escribe, en este orden y separados por nada (sin espacios): la variable «Fecha actual» con formato de fecha «ISO 8601», la variable «Comercio» (de «Entrada del atajo») y la variable «Importe» (de «Entrada del atajo»). Ese texto es el ID del pago. Se calcula UNA sola vez, aquí, antes de reintentar, para que los reintentos no dupliquen el pago. Pon a esta acción el nombre «ID».
3. Acción «Repetir»: repetir 3 veces. Dentro del bucle, en este orden:
   a. Acción «Obtener contenido de URL»:
      - URL: ${url}
      - Método: POST
      - Cabeceras: añade una con nombre «Content-Type» y valor «application/json».
      - Cuerpo de la solicitud: JSON, con estos campos de tipo texto:
          «shortcut_token» = ${KEY_PLACEHOLDER}
          «importe» = la variable «Importe» (de «Entrada del atajo»), como texto, tal cual
          «comercio» = la variable «Comercio» (de «Entrada del atajo»)
          «id_externo» = la variable «ID» (el texto del paso 2)
      - Si la acción tiene «Mostrar más», sube el tiempo de espera (timeout) al máximo posible: el servidor gratuito puede tardar unos 30 segundos en despertar.
      - Nombre del resultado: «Respuesta».
   b. Acción «Si»: si la «Respuesta» tiene un valor (es decir, el servidor respondió bien y no hay error):
      - Acción «Mostrar notificación»: «Pago guardado: [Comercio] [Importe]. Revísalo en Mi Economía.» (Comercio e Importe son variables).
      - Acción «Detener este atajo» para salir del bucle sin repetir más.
   c. «Si no» (la respuesta está vacía, tiene un error o la petición falló):
      - Acción «Esperar» 20 segundos y deja que el bucle haga el siguiente intento.
   d. «Fin Si».
4. Fin de «Repetir». Después del bucle (solo se llega aquí si los 3 intentos fallaron):
   - Acción «Mostrar notificación»: «No se pudo guardar el pago de [Comercio]. Añádelo a mano.»
   - Opcional, como alternativa: acción «Texto» con la dirección de mi app seguida de ?atajo=1&importe=[Importe codificado]&comercio=[Comercio codificado] y después «Abrir URLs», para abrir mi app con el pago ya rellenado.

IMPORTANTE SOBRE LA CLAVE: ${KEY_PLACEHOLDER} es un marcador. NO tienes mi clave ni debes inventarla. Déjalo escrito tal cual en tu respuesta y yo lo sustituiré a mano, dentro del campo «shortcut_token» de la acción «Obtener contenido de URL». No me pidas la clave.

PARTE 2. CREAR LA AUTOMATIZACIÓN
1. En Atajos, pestaña «Automatización», toca «Nueva automatización» (o «+»).
2. Elige «Transacción» (Cartera).
3. Marca mis tarjetas de Cartera (pueden quedar todas las categorías).
4. Elige «Ejecutar inmediatamente» (NO «Ejecutar tras confirmación»).
5. Toca «Siguiente» y elige el atajo «Mi Economía (segundo plano)».

Cuando pague, el pago quedará como pendiente y, al entrar en la app, veré la campana con el número de pagos por revisar.`
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

const MODES = [
  { id: 'app',   label: 'Abrir la app',    hint: 'Se abre la app y guardas con un toque' },
  { id: 'fondo', label: 'En segundo plano', hint: 'No se abre nada; queda pendiente' },
]

// Copia con el mismo patrón en todos los botones: "✓ Copiado" 2 s o aviso de fallo.
function useCopy() {
  const [copied, setCopied]         = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyFailed(false)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
      return true
    } catch {
      setCopyFailed(true)
      return false
    }
  }
  return { copied, copyFailed, copy }
}

function PromptBlock({ prompt }) {
  const { copied, copyFailed, copy } = useCopy()
  return (
    <section className="fm-card sc-step" aria-label="Prompt para una IA o para Atajos">
      <div className="sc-step-head">
        <span className="sc-step-num" aria-hidden="true">🤖</span>
        <h2 className="sc-step-title">Prompt para pegar en una IA / en Atajos</h2>
      </div>
      <p className="sc-text">
        ¿Prefieres que te lo monte una IA (ChatGPT, Claude...) o ir copiando las instrucciones tú? Copia este texto y pégalo.
        Describe, acción por acción, lo que hay que crear en la app Atajos.
      </p>
      <pre className="sc-prompt" data-testid="sc-prompt" tabIndex={0} aria-label="Texto del prompt">{prompt}</pre>
      <button type="button" className="shortcut-token-copy sc-copy-btn" onClick={() => copy(prompt)}>
        {copied ? '✓ Copiado' : 'Copiar prompt'}
      </button>
      <p className="sr-only" role="status" aria-live="polite">{copied ? 'Prompt copiado' : ''}</p>
      {copyFailed && (
        <p className="sc-warn" role="alert">No se pudo copiar automáticamente. Mantén pulsado el texto para seleccionarlo y copiarlo.</p>
      )}
    </section>
  )
}

function keyErrorMessage(err) {
  if (err?.status === 401) return 'Tu sesión ha caducado. Vuelve a iniciar sesión.'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'No hay conexión. Conéctate a internet y vuelve a intentarlo.'
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || [502, 503, 504].includes(err?.status)) {
    return 'El servidor está despertando, vuelve a intentarlo en unos segundos.'
  }
  if (err?.status) return 'No se pudo obtener la clave. Inténtalo de nuevo en unos segundos.'
  return 'No hay conexión con el servidor. Comprueba tu internet y vuelve a intentarlo.'
}

// La clave solo vive en el estado de este componente (se pierde al cambiar de
// modo o salir de la pantalla). No se guarda en localStorage ni en el prompt.
function KeyStep({ n }) {
  const [key, setKey]       = useState(null)
  const [shown, setShown]   = useState(false)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState('')
  const [copyOk, setCopyOk] = useState(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function reveal() {
    setBusy(true); setError(''); setCopyOk(null)
    try {
      const { shortcut_token } = await getShortcutToken()
      if (!alive.current) return
      if (!shortcut_token) throw new Error('vacía')
      setKey(shortcut_token)
      setShown(false)
      let ok = false
      try { await navigator.clipboard.writeText(shortcut_token); ok = true } catch { /* se avisa abajo */ }
      if (alive.current) setCopyOk(ok)
    } catch (e) {
      if (alive.current) { setKey(null); setError(keyErrorMessage(e)) }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <section className="fm-card sc-step" aria-labelledby={`sc-step-${n}`}>
      <StepHead n={n} title="Tu clave personal" />
      <p className="sc-tip sc-tip--warn sc-tip--inline" role="note">
        <span aria-hidden="true">🔑</span>
        <span>Es como una llave de tu cuenta solo para el Atajo. No la pegues en la IA ni la compartas: pégala solo en el campo marcado dentro del Atajo.</span>
      </p>
      <button type="button" className="fm-secondary fm-secondary--wide" onClick={reveal} disabled={busy}>
        {busy ? 'Pidiendo la clave…' : 'Mostrar y copiar mi clave'}
      </button>
      {key && (
        <div className="sc-copy">
          <span className="sc-copy-label">Tu clave</span>
          <code className="sc-copy-value" data-testid="sc-key">{shown ? key : '•'.repeat(12)}</code>
          <button type="button" className="shortcut-token-copy sc-copy-btn" aria-pressed={shown} onClick={() => setShown(v => !v)}>
            {shown ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">{copyOk ? 'Clave copiada' : ''}</p>
      {copyOk && <p className="sc-hint">✓ Clave copiada. Pégala en el Atajo, en el campo «shortcut_token».</p>}
      {copyOk === false && <p className="sc-warn" role="alert">No se pudo copiar automáticamente. Pulsa «Mostrar» y cópiala a mano.</p>}
      {error && <p className="sc-warn" role="alert">{error}</p>}
    </section>
  )
}

function ModeSelector({ mode, setMode }) {
  function onKey(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = MODES[(MODES.findIndex(m => m.id === mode) + 1) % MODES.length].id
    setMode(next)
  }
  return (
    <div className="sc-modes" role="tablist" aria-label="Cómo quieres recibir los pagos">
      {MODES.map(m => (
        <button key={m.id} type="button" role="tab" id={`sc-mode-${m.id}`} aria-selected={mode === m.id}
          aria-controls="sc-mode-panel" tabIndex={mode === m.id ? 0 : -1}
          className={`sc-mode${mode === m.id ? ' sc-mode--on' : ''}`}
          onClick={() => setMode(m.id)} onKeyDown={onKey}>
          <span className="sc-mode-label">{m.label}</span>
          <span className="sc-mode-hint">{m.hint}</span>
        </button>
      ))}
    </div>
  )
}

const SUBTITLES = {
  app:   'Cada vez que pagues con Apple Pay, se abrirá la app con el gasto ya rellenado para que lo guardes con un toque.',
  fondo: 'Cada vez que pagues con Apple Pay, el pago se guarda solo, sin abrir la app. Lo revisas después desde la campana.',
}

export default function ShortcutSetupScreen({ onClose, navigate = url => window.location.assign(url) }) {
  const link = shortcutLinkBase()
  const [mode, setMode] = useState('app')
  const { copied, copyFailed, copy } = useCopy()
  const copyLink = () => copy(link)
  const fondo = mode === 'fondo'

  return (
    <FormScreen title="Pagos automáticos (iPhone)" label="Configurar pagos automáticos con Apple Pay" onClose={onClose}
      subtitle={SUBTITLES[mode]}>

      <ModeSelector mode={mode} setMode={setMode} />

      <div id="sc-mode-panel" role="tabpanel" aria-labelledby={`sc-mode-${mode}`} className="sc-panel">

      {/* Qué hace y límites */}
      <section className="fm-card sc-intro" aria-label="Cómo funciona">
        <div className="sc-phone" aria-hidden="true">
          <div className="sc-phone-notch" />
          <div className="sc-phone-notif">
            <span className="sc-phone-app">{fondo ? '🔔' : '💶'}</span>
            <span className="sc-phone-text">
              <strong>{fondo ? 'Pago guardado' : 'Gasto recibido'}</strong>
              <span>12,40 € · Mercadona</span>
            </span>
          </div>
          <div className="sc-phone-cta">{fondo ? 'Pendiente (1)' : 'Guardar'}</div>
        </div>
        <ul className="sc-list">
          {fondo ? (
            <li>Pagas con Apple Pay → el iPhone manda el pago al servidor sin abrir nada → queda <strong>pendiente</strong>. Al entrar en la app verás la <strong>campana</strong> con el número de pagos por revisar.</li>
          ) : (
            <li>Pagas con Apple Pay → el iPhone abre la app → ves el gasto con su categoría sugerida → <strong>Guardar</strong>.</li>
          )}
          <li>Solo funciona con <strong>Apple Pay del iPhone</strong>. No con la tarjeta física ni con compras por internet.</li>
          <li>A veces iOS no avisa. Lo que falte, añádelo a mano como siempre.</li>
          <li>Necesitas iOS 17 o posterior.</li>
          {fondo && <li>Si el servidor estaba dormido, el Atajo reintenta solo hasta 3 veces. Si no lo consigue, te avisa con una notificación.</li>}
        </ul>
      </section>

      {/* Aviso Safari: solo si el Atajo abre la app */}
      {!fondo && (
        <section className="sc-tip sc-tip--warn" aria-label="Importante: Safari">
          <span aria-hidden="true">⚠️</span>
          <p>
            <strong>Importante:</strong> el iPhone abre el enlace en <strong>Safari</strong>, no en la app de la pantalla
            de inicio. Entra una vez en <strong>{window.location.host}</strong> desde Safari e inicia sesión (dura 30 días).
            Si sueles usar la app instalada, no pasa nada: el gasto también se guarda desde Safari.
          </p>
        </section>
      )}

      {fondo ? (
        <>
          <KeyStep n={1} />

          <section className="fm-card sc-step" aria-labelledby="sc-step-2">
            <StepHead n={2} title="Crea el Atajo" />
            <p className="sc-text">
              En Atajos, pestaña <strong>Atajos</strong>, toca <strong>+</strong> y llámalo <strong>Mi Economía (segundo plano)</strong>.
              Es largo de montar a mano: lo más cómodo es copiar el prompt de abajo y dárselo a una IA, o seguirlo tú acción por acción.
            </p>
            <div className="sc-actions" aria-label="Resumen de acciones del Atajo">
              <ActionBlock n={1} icon="💳" tone="accent" name="Recibir">
                <ActionRow k="Recibir" v={<><strong>Transacciones</strong> de <strong>Cartera</strong></>} />
              </ActionBlock>
              <ActionBlock n={2} icon="📝" tone="green" name="Texto (el ID del pago)">
                <p className="sc-hint">Fecha actual (ISO 8601) + comercio + importe, calculado una sola vez para que los reintentos no dupliquen el pago.</p>
              </ActionBlock>
              <ActionBlock n={3} icon="🔁" tone="orange" name="Repetir 3 veces">
                <p className="sc-hint">Dentro: «Obtener contenido de URL» (POST a <code>{BASE}/api/shortcut/pending</code>); «Si» sale bien → «Mostrar notificación»; si no → «Esperar» 20 segundos.</p>
              </ActionBlock>
              <ActionBlock n={4} icon="🔔" tone="red" name="Mostrar notificación">
                <p className="sc-hint">Tras 3 fallos: «No se pudo guardar el pago de COMERCIO. Añádelo a mano.»</p>
              </ActionBlock>
            </div>
          </section>
        </>
      ) : (
        <>
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
        </>
      )}

      {/* Paso 3 */}
      <section className="fm-card sc-step" aria-labelledby="sc-step-3">
        <StepHead n={3} title="Crea la automatización" />
        <ol className="sc-sublist">
          <li>En Atajos, pestaña <strong>Automatización</strong> → <strong>Nueva automatización</strong> (o <strong>+</strong>).</li>
          <li>Elige <strong>Transacción</strong>.</li>
          <li>Marca tus tarjetas de Cartera (puedes dejar todas las categorías).</li>
          <li>Elige <strong>Ejecutar inmediatamente</strong> (no «Ejecutar tras confirmación»).</li>
          <li>Toca <strong>Siguiente</strong> y elige el atajo <strong>{fondo ? 'Mi Economía (segundo plano)' : 'Mi Economía'}</strong>.</li>
        </ol>
      </section>

      {/* Paso 4 */}
      <section className="fm-card sc-step" aria-labelledby="sc-step-4">
        <StepHead n={4} title="Pruébalo" />
        {fondo ? (
          <p className="sc-text">
            Paga algo pequeño con Apple Pay. Al cabo de unos segundos, entra en la app: la <strong>campana</strong> debe mostrar
            un pago pendiente. Si el servidor estaba dormido, puede tardar hasta un minuto.
          </p>
        ) : (
          <>
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
          </>
        )}
      </section>

      <PromptBlock key={mode} prompt={fondo ? buildPromptBackground() : buildPromptApp(link)} />

      </div>
    </FormScreen>
  )
}
