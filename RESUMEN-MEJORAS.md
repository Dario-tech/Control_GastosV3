# Resumen de mejoras (rama `feat/mejoras-csv-compartidos-suscripciones-tickets`)

Partiendo de `qa`. Sin merge, sin PR, sin tocar producción ni ejecutar SQL contra ninguna BD remota. Un commit por funcionalidad. *(Actualizado: tickets y gastos compartidos se retiraron de `qa`.)*

## 1. Importar extractos del banco en CSV — hecho
- **App:** Ajustes → Datos y exportar → «Importar extracto del banco (CSV)» (`CsvImportScreen.jsx`, `utils/csvImport.js`). Elegir fichero, separador (autodetectado), formato de fecha, cabeceras sí/no, mapear fecha/concepto/importe, «por el signo» (negativo = gasto, positivo = ingreso) o «todo gastos», vista previa, **revisión con duplicados** y confirmación. Límites: 1 MB y 5.000 filas (se envía en trozos de 400).
- **Backend:** nuevo `POST /api/transactions/import` (`services/import_csv.py`). Sin `confirmar` es solo vista previa; con `confirmar: true` guarda en **una transacción** las filas nuevas, con `concepto_enc`/`importe_enc` cifrados (y doble escritura B2 si `legacy_plain` está activo, igual que `post_transaction`). Importes con `parse_importe` (el mismo de `/api/pending`), fecha con `parse_fecha`, tipo de la lista blanca, concepto ≤ 60. Duplicado = misma fecha + importe + comercio (sin mayúsculas ni espacios de más) ya guardados; cuenta ocurrencias, así dos cafés iguales el mismo día solo se marcan si ya había dos. El servidor repite la comprobación al confirmar. Rate limit 20/min y 300/día por usuario, cuerpo ≤ 160 KB, ≤ 500 filas por petición.
- Los gastos importados entran como «Gasto Variable» (el CSV no trae categoría); se recategorizan después.

## 2. Suscripciones — rehecho como gasto fijo (rama `feat/suscripciones-como-gasto-fijo`)
- Ya **no está en Ajustes**. En Mes, bajo «Gastos Fijos», hay una tarjeta «🔁 Suscripciones» con las que el usuario ha **marcado** (próxima renovación, total al mes y al año) y, plegadas, los gastos recurrentes detectados con el botón «Es suscripción». Reutiliza `/api/recurring`.
- Las categorías marcadas **cuentan como gasto fijo** (Mes y Año) y se agrupan en una fila «Suscripciones» del listado de fijos; el total de gastos no cambia, solo se reclasifica.
- Las marcas se guardan en los ajustes del usuario (`settings.subscriptions`), sin cambios de esquema ni de backend.
- Limitación: el servicio es el nombre de la categoría del gasto (Netflix, HBO…); si varios van bajo una misma categoría «Suscripciones» se verán por importe.

## 3 y 4. Gastos compartidos y tickets con IA — retirados de `qa`
Por decisión del usuario **no van a PROD**: se quitaron de `qa` (reversión) y siguen en las ramas feature `feat/tickets-por-lineas` (tickets con Gemini + lectura por líneas + gastos compartidos v2 integrados) y `feat/gastos-compartidos-integrados`. Las tablas antiguas de grupos (`expense_groups`, `expense_group_members`, `group_guests`, `group_expenses`, `group_expense_shares`, `group_settlements`) pueden existir en la BD de QA con datos de prueba: ya no las usa nadie y se pueden borrar con `DROP TABLE … CASCADE` cuando quieras.

## Tests ejecutados
- Backend (`pytest`): importar CSV, fijos que se repiten (también contra Postgres local), esquema/RLS, hardening, API. Frontend (`vitest`, los relacionados con lo tocado) y `npm run build`.
- No probado en un móvil real.

## A aplicar a mano en QA / producción
1. **Esquema:** solo los fijos que se repiten añaden una tabla (`fixed_recurring`, con RLS sin políticas); el backend la crea al arrancar y está en `backend/schema.sql`. Importar CSV y suscripciones no cambian el esquema.
2. **Variables de entorno:** ninguna.
3. `DB_ENCRYPTION_KEY` debe ser la de cada entorno: los fijos que se repiten se cifran con ella.

## Pendiente / a decidir
- Si el importador debe asignar categoría por reglas (hoy todo entra como Gasto Variable).
