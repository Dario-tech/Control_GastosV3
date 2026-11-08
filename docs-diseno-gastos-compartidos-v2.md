# Gastos compartidos v2: integrados en Mi Economía (propuesta para decidir)

**Estado:** solo diseño, nada programado. Sustituye a `docs-diseno-gastos-compartidos.md` (v1, estilo Splitwise, colgando de Ajustes) cuando se elija un enfoque.

## Por qué la v1 no sirve
- Vive en Ajustes → es una app aparte dentro de la app. Apuntar un gasto allí **no** toca Mes/Año/presupuestos, y lo que tú ya apuntas en Mi Economía no aparece allí.
- Es el modelo «grupo → gastos → saldos» de Splitwise/Tricount, que ya usas y hacen mejor.

## La idea que hace distinto a Mi Economía
Splitwise y Tricount **no saben cuánto ganas ni cuánto te has gastado de verdad**. Mi Economía sí. Así que el valor no es «repartir cuentas» sino **que tu parte entre en tu economía y que sepas qué te deben/debes sin salir de ella**. Tres decisiones comunes a cualquier enfoque:

1. **Tu gasto real = tu parte.** Cena de 60 € entre 3: en Mes/Año/presupuesto/estadísticas cuentan **20 €** (categoría «Restaurantes»). Los otros 40 € que adelantas **no** son gasto tuyo: son «te deben 40 €».
2. **Pagar o cobrar una deuda no es gasto ni ingreso.** Si Ana te devuelve 20 €, es un movimiento neutro (liquidación): no infla tus ingresos ni tus gastos.
3. **Un gasto compartido es un movimiento normal con una etiqueta extra** («compartido con…»), no una entidad aparte. Sale en Mes igual que los demás, con un distintivo.

## Los 3 enfoques

### A · «Dividir» al apuntar un gasto (recomendado como base)
**Ejemplo cena en grupo:** pagas 60 € de la cena. En «Añadir gasto» pones 60 €, Restaurantes, y tocas **«Dividir»** → eliges a Ana y Luis (o «los de siempre») → «a partes iguales». Guardas.
- En **Mes** aparece «Cena 20 €» con un distintivo `👥 te deben 40 €`. En Año/Estadísticas/presupuesto cuenta 20 €.
- Si en vez de ti paga Ana: «Dividir → pagó Ana». Tú registras tu parte (20 €) y queda `debes 20 € a Ana`.
- **Pantalla nueva mínima:** «Con quién tengo cuentas» (lista de personas con su saldo: `Ana te debe 35 €`, `debes 12 € a Luis`), accesible desde un botón en la cabecera de Mes. Desde ahí: «Liquidar» (marca que ya pagó/pagaste) y ver los gastos que lo componen.
- **Piso compartido:** gastos recurrentes (alquiler, luz) con «Dividir entre 3» ya guardado; cada mes sale con tu parte.
- **Viaje:** sin grupos. Cada gasto lleva una **etiqueta opcional** («Lisboa»); filtrando por etiqueta ves el total del viaje y quién debe qué.
- **Datos:** `transactions` ya tiene tu parte como `importe`. Se añade tabla `shared_expenses` (total cifrado, pagador, fecha, etiqueta) + `shared_expense_shares` (parte de cada persona, cifrada) + `shared_settlements`, y `transactions.shared_id` (nullable). **Se reutiliza de `groups.py`:** reparto en céntimos con resto determinista, validación de partes (suma = total), invitados sin cuenta, directorio de usuarios, saldo simplificado, cifrado, rate limits, tests de aislamiento. **Se descarta:** `expense_groups`/miembros como centro del modelo, los endpoints `/api/groups…` y `GroupsScreen.jsx`.
- **Esfuerzo:** medio (≈ 2 semanas de trabajo parcial). **Riesgos:** editar/borrar un gasto ya dividido (hay que decidir qué pasa con las deudas), y que los demás no tengan la app (ver pregunta 2).

### B · Libro de cuentas con personas (sin grupos ni reparto detallado)
**Ejemplo:** «Ana me debe 15 € del cine», «Luis me debe 40 € de la gasolina». Solo hay **personas y apuntes de deuda**, tipo libreta.
- En Mes, cada gasto tiene la acción «Prestado / me deben…» → persona + importe. No hay grupos ni divisiones complejas.
- Pantalla «Cuentas» con saldo por persona y botón «Saldada».
- Tu gasto real se queda como lo apuntaste (o se baja a tu parte, a elegir).
- **Muy simple y rápido de construir (≈ 1 semana)**, pero no sirve bien para un viaje de 6 personas ni para un piso (tendrías que apuntar cada deuda a mano).

### C · «Eventos» con gastos que se reflejan solos (lo más cercano a Tricount)
**Ejemplo viaje:** creas «Lisboa» una vez, añades a los 5. Cada gasto del viaje se apunta **desde el mismo botón +**, eligiendo «Evento: Lisboa»; en tu Mes aparece solo tu parte, y una pestaña/pantalla «Lisboa» muestra el total, saldos y «quién paga a quién».
- Es el enfoque que más reutiliza `groups.py` (casi todo vale) y el que mejor resuelve viajes y pisos, pero **es el que más se parece a un Splitwise**: una pantalla de grupo con su lista, saldos y liquidaciones. Es lo que has dicho que no quieres como centro.
- **Esfuerzo:** medio-alto (≈ 2-3 semanas). Riesgo: acabar con dos formas de apuntar un gasto.

### Extra (cualquiera de ellos, después): importar
Splitwise exporta CSV y Tricount exporta Excel/CSV. Un importador para traer **deudas actuales** (no todo el histórico) evitaría empezar de cero. Ya existe `CsvImportScreen`/`import_csv.py` que se puede reutilizar.

## Comparativa rápida
| | A · Dividir | B · Libreta | C · Eventos |
|---|---|---|---|
| Dónde vive | Botón en Añadir gasto + «Cuentas» desde Mes | Acción en un gasto + «Cuentas» | Selector en Añadir gasto + pantalla por evento |
| Mi parte cuenta en Mes/Año/presupuesto | Sí, automático | Opcional | Sí, automático |
| Cena en grupo | Muy bien | Regular | Bien |
| Piso compartido | Bien (recurrentes con reparto) | Mal | Bien |
| Viaje | Bien (etiqueta) | Mal | Muy bien |
| Parecido a Splitwise | Poco | Nada | Bastante |
| Esfuerzo | Medio | Bajo | Medio-alto |

## Recomendación
**A** como base: la acción pasa en el sitio donde ya apuntas gastos, tu parte entra sola en tu economía, y el saldo «con quién tengo cuentas» sale de ahí. Los viajes se cubren con una etiqueta; si más adelante hace falta una vista de «evento» (C), se construye encima del mismo modelo sin tirar nada. B se queda corta; C replica lo que ya tienes en Splitwise/Tricount.

## Qué cambiaría en el repo (si se elige A)
- Backend: nuevo `services/shared.py` (reutiliza funciones de reparto/saldo de `groups.py`), tablas nuevas idempotentes con RLS sin políticas, importes/conceptos cifrados con `services/crypto.py`, toda consulta filtra por pertenencia (sin fugas entre usuarios), rate limits y validación como el resto. El alta de gasto compartido crea el movimiento propio **y** el reparto en una sola transacción de BD.
- Frontend: `AddTransactionModal` (paso «Dividir»), `MonthTab` (distintivo y «te deben»), pantalla «Cuentas», retirada de `GroupsScreen.jsx` y su entrada en `SettingsTab.jsx`.
- Datos antiguos: los grupos de la v1 (si los hay en QA) se pueden dejar de usar sin migrar; sin producción afectada.
- Hecho a mano: `RESUMEN-GASTOS-COMPARTIDOS-V2.md` listará el SQL a aplicar en QA/producción cuando llegue el momento.

## Necesito de la otra sesión (lectura de ticket por líneas, Gemini)
Nada para empezar. Más adelante, el escaneo por líneas permitiría **asignar cada línea del ticket a una persona** (tu parte = tus líneas). Pediría que `/api/ticket-scan` devuelva líneas `{descripcion, importe}`; yo consumiría eso sin tocar `ticket_scan.py`.

## Preguntas abiertas (para el usuario)
1. ¿Enfoque A, B o C?
2. ¿Con quién compartes: gente que **también tendría Mi Economía** (pareja, familia) o sobre todo gente que **no la va a usar**? Cambia si sus movimientos aparecen en su app o solo en la tuya.
3. ¿En tu presupuesto debe contar **tu parte** (recomendado) o lo que pagaste en total?
4. ¿Qué sigues necesitando de Splitwise/Tricount que no quieres perder (viajes, avisos, varias monedas, exportar)?
