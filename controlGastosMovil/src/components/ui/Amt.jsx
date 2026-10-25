// Envuelve una cifra monetaria dentro de un texto para que «Ocultar importes»
// la difumine (regla `.hide-amounts .amt` en App.css) sin tocar el resto del texto.
export default function Amt({ children }) {
  return <span className="amt">{children}</span>
}
