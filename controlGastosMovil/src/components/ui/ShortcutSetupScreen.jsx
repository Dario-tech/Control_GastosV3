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
   - "manual": paso a paso sin IA, de los dos tipos.
   La clave solo se pide al servidor al pulsar «Copiar prompt» / «Copiar mi clave»: va al
   portapapeles y NUNCA se pinta, se guarda ni se registra. El prompt que se ve lleva el marcador.
   La PWA no puede leer Cartera ni instalar automatizaciones: solo guía. */

// \u003c = «<» (escrito así para no confundir al test de imports que busca etiquetas JSX).
export const KEY_PLACEHOLDER = '\u003cPEGA_AQUI_TU_CLAVE>'

export const KEY_WARNING = 'El prompt copiado incluye tu clave personal: pégalo solo en Atajos y no lo compartas.'

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
Atención al orden: primero el importe (resultado de la SEGUNDA acción «Codificar URL») y después el comercio (resultado de la PRIMERA). Los dos textos entre corchetes son variables: se insertan tocando «Variable» encima del teclado y eligiendo el resultado de cada «Codificar URL». No se escriben a mano.
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

// Prompt del modo "En segundo plano". Lleva la URL real de la API y, en `key`, el
// marcador por defecto (lo que se ve en pantalla). Al copiar se llama con la clave
// real, que solo acaba en el portapapeles, nunca en pantalla.
export function buildPromptBackground(api = BASE, key = KEY_PLACEHOLDER) {
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
          «shortcut_token» = ${key}
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

IMPORTANTE SOBRE LA CLAVE: mi clave personal ya va incluida en este texto, en el campo «shortcut_token» de la acción «Obtener contenido de URL». Úsala tal cual en ese campo. NO la repitas ni la muestres en tus respuestas (ni en resúmenes ni en ejemplos): si necesitas referirte a ella, di «tu clave».

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
  { id: 'app',    label: 'Abrir la app',     hint: 'Guardas con un toque' },
  { id: 'fondo',  label: 'En segundo plano', hint: 'Queda pendiente' },
  { id: 'manual', label: 'Manual',           hint: 'Paso a paso, sin IA' },
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

function keyErrorMessage(err) {
  if (err?.status === 401) return 'Tu sesión ha caducado. Vuelve a iniciar sesión.'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'No hay conexión. Conéctate a internet y vuelve a intentarlo.'
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || [502, 503, 504].includes(err?.status)) {
    return 'El servidor está despertando, vuelve a intentarlo en unos segundos.'
  }
  if (err?.status) return 'No se pudo obtener la clave. Inténtalo de nuevo en unos segundos.'
  return 'No hay conexión con el servidor. Comprueba tu internet y vuelve a intentarlo.'
}

async function fetchKey() {
  const { shortcut_token } = await getShortcutToken()
  if (!shortcut_token) throw new Error('clave vacía')
  return shortcut_token
}

/* Copia al portapapeles un texto que lleva la clave real, sin pintarla.
   - Pide la clave (getShortcutToken) y construye el texto con build(clave).
   - Safari/iOS: writeText tras un await pierde el gesto del usuario, así que se llama
     a clipboard.write con un ClipboardItem cuyo contenido es una PROMESA del texto
     (se resuelve cuando llega la clave). Sin ClipboardItem, se usa writeText.
   - Plan B si el portapapeles falla pero la clave llegó: se guarda en una referencia
     (no en estado) y se muestra «Pulsa otra vez para copiar»; el segundo toque ya
     tiene la clave. Si vuelve a fallar: textarea de solo lectura con el texto, que se
     oculta (y se borra la clave) al copiar o al pulsar «Ya lo he copiado».
   - Si no hay clave (sesión caducada, sin conexión) solo muestra el error: nunca
     copia un texto sin clave. */
function useSecretCopy(build) {
  const keyRef   = useRef(null)
  const buildRef = useRef(build)
  buildRef.current = build
  const alive = useRef(true)
  const timer = useRef(null)
  const [busy, setBusy]       = useState(false)
  const [copied, setCopied]   = useState(false)
  const [error, setError]     = useState('')
  const [retry, setRetry]     = useState(false)
  const [manual, setManual]   = useState(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; keyRef.current = null; clearTimeout(timer.current) }
  }, [])

  function done() {
    keyRef.current = null
    if (!alive.current) return
    setRetry(false); setManual(null); setError(''); setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (alive.current) setCopied(false) }, 2500)
  }

  function dismissManual() {
    keyRef.current = null
    setManual(null); setRetry(false)
  }

  function copy() {
    setError(''); setCopied(false); setBusy(true)
    const keyP  = keyRef.current ? Promise.resolve(keyRef.current) : fetchKey()
    const textP = keyP.then(k => { keyRef.current = k; return buildRef.current(k) })
    let writing
    try {
      const cb = navigator.clipboard
      writing = (typeof ClipboardItem !== 'undefined' && typeof cb?.write === 'function')
        ? cb.write([new ClipboardItem({ 'text/plain': textP.then(t => new Blob([t], { type: 'text/plain' })) })])
        : textP.then(t => cb.writeText(t))
    } catch (e) {
      writing = Promise.reject(e)
    }
    return writing.then(done, async () => {
      let text
      try { text = await textP } catch (e) {
        keyRef.current = null
        if (alive.current) setError(keyErrorMessage(e))
        return
      }
      if (!alive.current) return
      if (retry) setManual(text); else setRetry(true)
    }).finally(() => { if (alive.current) setBusy(false) })
  }

  return { copy, busy, copied, error, retry, manual, dismissManual, done }
}

// Avisos comunes de los botones que copian algo con la clave.
function SecretCopyFeedback({ sc, okText }) {
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">{sc.copied ? 'Copiado' : ''}</p>
      {sc.copied && <p className="sc-hint">✓ {okText}</p>}
      {sc.retry && !sc.manual && <p className="sc-warn" role="alert">Pulsa otra vez para copiar</p>}
      {sc.manual != null && (
        <div className="sc-manual-copy">
          <p className="sc-warn" role="alert">No se pudo copiar automáticamente. Selecciona el texto, cópialo y pulsa «Ya lo he copiado».</p>
          <textarea className="sc-prompt" readOnly rows={8} value={sc.manual} aria-label="Texto para copiar a mano"
            onFocus={e => e.target.select()} onCopy={sc.done} />
          <button type="button" className="fm-secondary fm-secondary--wide" onClick={sc.dismissManual}>Ya lo he copiado</button>
        </div>
      )}
      {sc.error && <p className="sc-warn" role="alert">{sc.error}</p>}
    </>
  )
}

// Prompt para pegar en la IA de Atajos. Con `withKey`, al copiar se sustituye el
// marcador por la clave real; en pantalla siempre se ve el marcador.
function PromptBlock({ prompt, withKey = false, buildCopy }) {
  const plain = useCopy()
  const sc = useSecretCopy(buildCopy || (() => prompt))
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
      {withKey ? (
        <>
          <button type="button" className="shortcut-token-copy sc-copy-btn" onClick={sc.copy} disabled={sc.busy}>
            {sc.busy ? 'Copiando…' : sc.copied ? '✓ Copiado' : 'Copiar prompt'}
          </button>
          <p className="sc-hint sc-key-warning">{KEY_WARNING}</p>
          <SecretCopyFeedback sc={sc} okText="Prompt copiado con tu clave. Pégalo en la IA de Atajos." />
        </>
      ) : (
        <>
          <button type="button" className="shortcut-token-copy sc-copy-btn" onClick={() => plain.copy(prompt)}>
            {plain.copied ? '✓ Copiado' : 'Copiar prompt'}
          </button>
          <p className="sr-only" role="status" aria-live="polite">{plain.copied ? 'Copiado' : ''}</p>
          {plain.copyFailed && (
            <p className="sc-warn" role="alert">No se pudo copiar automáticamente. Mantén pulsado el texto para seleccionarlo y copiarlo.</p>
          )}
        </>
      )}
    </section>
  )
}

// Botón «Copiar mi clave»: la clave va al portapapeles sin mostrarse nunca.
function KeyCopy() {
  const sc = useSecretCopy(k => k)
  return (
    <div className="sc-keycopy">
      <p className="sc-tip sc-tip--warn sc-tip--inline" role="note">
        <span aria-hidden="true">🔑</span>
        <span>Es como una llave de tu cuenta solo para el Atajo. No la pegues en ninguna IA ni la compartas: pégala solo en el campo «shortcut_token» dentro del Atajo. No se muestra en pantalla: se copia directamente.</span>
      </p>
      <button type="button" className="fm-secondary fm-secondary--wide" onClick={sc.copy} disabled={sc.busy}>
        {sc.busy ? 'Pidiendo la clave…' : sc.copied ? '✓ Copiada' : 'Copiar mi clave'}
      </button>
      <SecretCopyFeedback sc={sc} okText="Clave copiada. Pégala en el campo «shortcut_token»." />
    </div>
  )
}

// Valor + botón de copiar (URL de la API, enlace de la app...).
function CopyField({ label, value, buttonLabel, testId }) {
  const { copied, copyFailed, copy } = useCopy()
  return (
    <div className="sc-copy">
      <span className="sc-copy-label">{label}</span>
      <code className="sc-copy-value" data-testid={testId}>{value}</code>
      <button type="button" className="shortcut-token-copy sc-copy-btn" onClick={() => copy(value)}>
        {copied ? '✓ Copiado' : buttonLabel}
      </button>
      <p className="sr-only" role="status" aria-live="polite">{copied ? 'Copiado' : ''}</p>
      {copyFailed && (
        <p className="sc-warn" role="alert">No se pudo copiar automáticamente. Mantén pulsado el texto para copiarlo.</p>
      )}
    </div>
  )
}

function ModeSelector({ mode, setMode }) {
  function onKey(e) {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const i = MODES.findIndex(m => m.id === mode)
    const next = MODES[(i + d + MODES.length) % MODES.length].id
    setMode(next)
    requestAnimationFrame(() => document.getElementById(`sc-mode-${next}`)?.focus())
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
  app:    'Cada vez que pagues con Apple Pay, se abrirá la app con el gasto ya rellenado para que lo guardes con un toque.',
  fondo:  'Cada vez que pagues con Apple Pay, el pago se guarda solo, sin abrir la app. Lo revisas después desde la campana.',
  manual: 'Monta el Atajo tú mismo, acción por acción, sin IA. Elige el tipo que prefieras.',
}

// Acciones del Atajo «Abrir la app» (se usan en el modo y en el Manual).
function AppActions({ link }) {
  return (
    <div className="sc-actions" aria-label="Acciones del Atajo">
      <ActionBlock n={1} icon="💳" tone="accent" name="Recibir entrada">
        <ActionRow k="Recibir" v={<><strong>Transacciones</strong> de <strong>Cartera</strong></>} />
        <p className="sc-hint">Suele aparecer arriba del todo al tocar el atajo (ⓘ → «Recibir»).</p>
      </ActionBlock>

      <ActionBlock n={2} icon="🔤" tone="orange" name="Codificar URL (comercio)">
        <ActionRow k="Codificar" v={<><Var>Entrada del atajo</Var> → <strong>Comercio</strong></>} />
        <p className="sc-hint">Toca la variable y elige <strong>Comercio</strong>. Así funcionan nombres con espacios o acentos.</p>
      </ActionBlock>

      <ActionBlock n={3} icon="🔤" tone="orange" name="Codificar URL (importe)">
        <ActionRow k="Codificar" v={<><Var>Entrada del atajo</Var> → <strong>Importe</strong></>} />
      </ActionBlock>

      <ActionBlock n={4} icon="📝" tone="green" name="Texto">
        <p className="sc-text sc-text-build">
          Pega el enlace y añade detrás, sin espacios:
        </p>
        <code className="sc-formula">
          {link}<wbr />&amp;importe=<Var>resultado de Codificar URL (importe)</Var><wbr />&amp;comercio=<Var>resultado de Codificar URL (comercio)</Var>
        </code>
        <p className="sc-hint">Primero el importe y después el comercio. Las fichas azules se insertan tocando <strong>Variable</strong> encima del teclado y eligiendo el resultado de cada «Codificar URL».</p>
      </ActionBlock>

      <ActionBlock n={5} icon="🧭" tone="red" name="Abrir URLs">
        <ActionRow k="Abrir" v={<Var>Texto</Var>} />
      </ActionBlock>
    </div>
  )
}

// Acciones del Atajo «En segundo plano», con todos los campos.
function FondoActions({ api }) {
  return (
    <div className="sc-actions" aria-label="Acciones del Atajo en segundo plano">
      <ActionBlock n={1} icon="💳" tone="accent" name="Recibir">
        <ActionRow k="Recibir" v={<><strong>Transacciones</strong> de <strong>Cartera</strong></>} />
      </ActionBlock>

      <ActionBlock n={2} icon="📝" tone="green" name="Texto (el ID del pago)">
        <p className="sc-text">En este orden y sin espacios:</p>
        <code className="sc-formula">
          <Var>Fecha actual</Var> (formato <strong>ISO 8601</strong>)<wbr /><Var>Comercio</Var><wbr /><Var>Importe</Var>
        </code>
        <p className="sc-hint">«Comercio» e «Importe» salen de «Entrada del atajo». Se calcula UNA sola vez, antes de reintentar, para que los reintentos no dupliquen el pago. Ponle a esta acción el nombre <strong>ID</strong>.</p>
      </ActionBlock>

      <ActionBlock n={3} icon="🔁" tone="orange" name="Repetir">
        <ActionRow k="Repetir" v={<strong>3 veces</strong>} />
        <p className="sc-hint">Las acciones 4 a 7 van DENTRO del bucle.</p>
      </ActionBlock>

      <ActionBlock n={4} icon="🌐" tone="accent" name="Obtener contenido de URL">
        <ActionRow k="URL" v={<code>{api}/api/shortcut/pending</code>} />
        <ActionRow k="Método" v={<strong>POST</strong>} />
        <ActionRow k="Cabeceras" v={<><code>Content-Type</code> = <code>application/json</code></>} />
        <ActionRow k="Cuerpo" v={<strong>JSON</strong>} />
        <p className="sc-hint">Añade estos campos, todos de tipo <strong>Texto</strong>:</p>
        <ActionRow k="shortcut_token" v="tu clave personal (botón «Copiar mi clave» de abajo)" />
        <ActionRow k="importe" v={<><Var>Importe</Var> de Entrada del atajo, tal cual</>} />
        <ActionRow k="comercio" v={<><Var>Comercio</Var> de Entrada del atajo</>} />
        <ActionRow k="id_externo" v={<><Var>ID</Var> (la acción 2)</>} />
        <p className="sc-hint">En «Mostrar más», sube el tiempo de espera (timeout) al máximo: el servidor gratuito puede tardar unos 30 segundos en despertar. Ponle de nombre al resultado <strong>Respuesta</strong>.</p>
      </ActionBlock>

      <ActionBlock n={5} icon="❓" tone="orange" name="Si">
        <ActionRow k="Si" v={<><Var>Respuesta</Var> <strong>tiene algún valor</strong></>} />
      </ActionBlock>

      <ActionBlock n={6} icon="🔔" tone="green" name="Mostrar notificación + Detener este atajo">
        <p className="sc-hint">Dentro del «Si»: «Mostrar notificación» con «Pago guardado: Comercio Importe. Revísalo en Mi Economía.» (variables) y después «Detener este atajo» para salir del bucle.</p>
      </ActionBlock>

      <ActionBlock n={7} icon="⏳" tone="orange" name="Si no → Esperar">
        <ActionRow k="Esperar" v={<strong>20 segundos</strong>} />
        <p className="sc-hint">En el «Si no», y después «Fin Si». Al terminar la vuelta, el bucle hace el siguiente intento.</p>
      </ActionBlock>

      <ActionBlock n={8} icon="🔁" tone="orange" name="Fin de Repetir">
        <p className="sc-hint">Cierra el bucle. Solo se llega aquí si los 3 intentos fallaron.</p>
      </ActionBlock>

      <ActionBlock n={9} icon="🔔" tone="red" name="Mostrar notificación">
        <p className="sc-hint">«No se pudo guardar el pago de Comercio. Añádelo a mano.»</p>
      </ActionBlock>
    </div>
  )
}

function AutomationSteps({ n, shortcutName }) {
  return (
    <section className="fm-card sc-step" aria-labelledby={`sc-step-${n}`}>
      <StepHead n={n} title="Crea la automatización" />
      <ol className="sc-sublist">
        <li>En Atajos, pestaña <strong>Automatización</strong> → <strong>Nueva automatización</strong> (o <strong>+</strong>).</li>
        <li>Elige <strong>Transacción</strong>.</li>
        <li>Marca tus tarjetas de Cartera (puedes dejar todas las categorías).</li>
        <li>Elige <strong>Ejecutar inmediatamente</strong> (no «Ejecutar tras confirmación»).</li>
        <li>Toca <strong>Siguiente</strong> y elige el atajo <strong>{shortcutName}</strong>.</li>
      </ol>
    </section>
  )
}

// Modo Manual: los dos tipos, paso a paso y sin IA.
function ManualMode({ link, api }) {
  const url = `${api}/api/shortcut/pending`
  return (
    <>
      <section className="fm-card sc-step" aria-labelledby="sc-man-app">
        <div className="sc-step-head">
          <span className="sc-step-num" aria-hidden="true">A</span>
          <h2 className="sc-step-title" id="sc-man-app">Tipo «Abrir la app»</h2>
        </div>
        <p className="sc-text">El Atajo abre la app con el pago ya rellenado y lo guardas con un toque. No usa claves.</p>
        <CopyField label="Enlace del atajo" value={link} buttonLabel="Copiar enlace de la app" testId="sc-man-link" />
        <ol className="sc-sublist">
          <li>Abre la app <strong>Atajos</strong>, pestaña <strong>Atajos</strong>, y toca <strong>+</strong>.</li>
          <li>Ponle de nombre <strong>Mi Economía</strong>.</li>
          <li>Añade estas acciones, en este orden:</li>
        </ol>
        <AppActions link={link} />
        <p className="sc-hint">Después crea la automatización (abajo) con el atajo <strong>Mi Economía</strong>. El iPhone abre el enlace en Safari: entra una vez en {window.location.host} desde Safari e inicia sesión.</p>
      </section>

      <section className="fm-card sc-step" aria-labelledby="sc-man-fondo">
        <div className="sc-step-head">
          <span className="sc-step-num" aria-hidden="true">B</span>
          <h2 className="sc-step-title" id="sc-man-fondo">Tipo «En segundo plano»</h2>
        </div>
        <p className="sc-text">El Atajo manda el pago directamente al servidor, sin abrir nada. Queda pendiente y lo revisas desde la campana.</p>
        <CopyField label="URL de la API" value={url} buttonLabel="Copiar URL de la API" testId="sc-man-api" />
        <KeyCopy />
        <ol className="sc-sublist">
          <li>En Atajos, pestaña <strong>Atajos</strong>, toca <strong>+</strong> y llámalo <strong>Mi Economía (segundo plano)</strong>.</li>
          <li>Añade estas acciones, en este orden:</li>
        </ol>
        <FondoActions api={api} />
        <p className="sc-hint">Opcional, tras el aviso de fallo: acción «Texto» con el enlace de la app, <code>&amp;importe=</code> y <code>&amp;comercio=</code> (codificados) y «Abrir URLs», para abrir la app con el pago ya rellenado.</p>
      </section>

      <section className="fm-card sc-step" aria-labelledby="sc-man-auto">
        <div className="sc-step-head">
          <span className="sc-step-num" aria-hidden="true">3</span>
          <h2 className="sc-step-title" id="sc-man-auto">Crea la automatización (los dos tipos)</h2>
        </div>
        <ol className="sc-sublist">
          <li>En Atajos, pestaña <strong>Automatización</strong> → <strong>Nueva automatización</strong> (o <strong>+</strong>).</li>
          <li>Elige <strong>Transacción</strong>.</li>
          <li>Marca tus tarjetas de Cartera (puedes dejar todas las categorías).</li>
          <li>Elige <strong>Ejecutar inmediatamente</strong> (no «Ejecutar tras confirmación»).</li>
          <li>Toca <strong>Siguiente</strong> y elige el atajo <strong>Mi Economía</strong> o <strong>Mi Economía (segundo plano)</strong>.</li>
        </ol>
      </section>
    </>
  )
}

export default function ShortcutSetupScreen({ onClose, navigate = url => window.location.assign(url) }) {
  const link = shortcutLinkBase()
  const [mode, setMode] = useState('app')
  const { copied, copyFailed, copy } = useCopy()
  const copyLink = () => copy(link)
  const fondo = mode === 'fondo'
  const manual = mode === 'manual'

  return (
    <FormScreen title="Pagos automáticos (iPhone)" label="Configurar pagos automáticos con Apple Pay" onClose={onClose}
      subtitle={SUBTITLES[mode]}>

      <ModeSelector mode={mode} setMode={setMode} />

      <div id="sc-mode-panel" role="tabpanel" aria-labelledby={`sc-mode-${mode}`} className="sc-panel">

      {/* Qué hace y límites */}
      {!manual && (
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
      )}

      {/* Aviso Safari: solo si el Atajo abre la app */}
      {mode === 'app' && (
        <section className="sc-tip sc-tip--warn" aria-label="Importante: Safari">
          <span aria-hidden="true">⚠️</span>
          <p>
            <strong>Importante:</strong> el iPhone abre el enlace en <strong>Safari</strong>, no en la app de la pantalla
            de inicio. Entra una vez en <strong>{window.location.host}</strong> desde Safari e inicia sesión (dura 30 días).
            Si sueles usar la app instalada, no pasa nada: el gasto también se guarda desde Safari.
          </p>
        </section>
      )}

      {manual ? (
        <ManualMode link={link} api={BASE} />
      ) : fondo ? (
        <>
          <section className="fm-card sc-step" aria-labelledby="sc-step-1">
            <StepHead n={1} title="Crea el Atajo" />
            <p className="sc-text">
              En Atajos, pestaña <strong>Atajos</strong>, toca <strong>+</strong> y llámalo <strong>Mi Economía (segundo plano)</strong>.
              Es largo de montar a mano: lo más cómodo es copiar el prompt de abajo y dárselo a una IA de Atajos. Si prefieres hacerlo tú, usa la pestaña «Manual».
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
          <AutomationSteps n={2} shortcutName="Mi Economía (segundo plano)" />
          <section className="fm-card sc-step" aria-labelledby="sc-step-3">
            <StepHead n={3} title="Pruébalo" />
            <p className="sc-text">
              Paga algo pequeño con Apple Pay. Al cabo de unos segundos, entra en la app: la <strong>campana</strong> debe mostrar
              un pago pendiente. Si el servidor estaba dormido, puede tardar hasta un minuto.
            </p>
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
            <AppActions link={link} />
          </section>

          <AutomationSteps n={3} shortcutName="Mi Economía" />

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
        </>
      )}

      {mode === 'app' && <PromptBlock key="app" prompt={buildPromptApp(link)} />}
      {fondo && <PromptBlock key="fondo" withKey prompt={buildPromptBackground()} buildCopy={k => buildPromptBackground(BASE, k)} />}

      </div>
    </FormScreen>
  )
}
