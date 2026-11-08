# Resumen de mejoras (rama `feat/mejoras-csv-compartidos-suscripciones-tickets`)

Partiendo de `qa`. Sin merge, sin PR, sin tocar producción ni ejecutar SQL contra ninguna BD remota. Un commit por funcionalidad.

## 1. Importar extractos del banco en CSV — hecho
- **App:** Ajustes → Datos y exportar → «Importar extracto del banco (CSV)» (`CsvImportScreen.jsx`, `utils/csvImport.js`). Elegir fichero, separador (autodetectado), formato de fecha, cabeceras sí/no, mapear fecha/concepto/importe, «por el signo» (negativo = gasto, positivo = ingreso) o «todo gastos», vista previa, **revisión con duplicados** y confirmación. Límites: 1 MB y 5.000 filas (se envía en trozos de 400).
- **Backend:** nuevo `POST /api/transactions/import` (`services/import_csv.py`). Sin `confirmar` es solo vista previa; con `confirmar: true` guarda en **una transacción** las filas nuevas, con `concepto_enc`/`importe_enc` cifrados (y doble escritura B2 si `legacy_plain` está activo, igual que `post_transaction`). Importes con `parse_importe` (el mismo de `/api/pending`), fecha con `parse_fecha`, tipo de la lista blanca, concepto ≤ 60. Duplicado = misma fecha + importe + comercio (sin mayúsculas ni espacios de más) ya guardados; cuenta ocurrencias, así dos cafés iguales el mismo día solo se marcan si ya había dos. El servidor repite la comprobación al confirmar. Rate limit 20/min y 300/día por usuario, cuerpo ≤ 160 KB, ≤ 500 filas por petición.
- Los gastos importados entran como «Gasto Variable» (el CSV no trae categoría); se recategorizan después.

## 2. Calendario de suscripciones — hecho
- Ajustes → **Suscripciones** (`SubscriptionsScreen.jsx`, `utils/subscriptions.js`). Reutiliza `/api/recurring` y `cleanRecurring` (excluye ingresos y caducados, corrige fechas pasadas). Muestra total mensual y anual (equivalente por frecuencia) y la próxima renovación de cada una, ordenadas por fecha. **Sin cambios de backend ni de esquema.**

## 3. Gastos compartidos — hecho (v1 mínima)
- Diseño previo en `docs-diseno-gastos-compartidos.md` (commit aparte) y seguido tal cual.
- **Backend:** `services/groups.py` + 11 endpoints (`/api/groups…`, invitados y directorio) en `main.py`. Grupos con miembros elegidos del **directorio de usuarios de la app** (`GET /api/users/directory`) o, si no tienen cuenta, **añadidos solo con un nombre** (invitados, clave `invitado:<id>`, nombre cifrado), gastos con pagador y reparto igual o por importes (suma exacta, en céntimos), pagos entre miembros y saldo «quién debe a quién» (deudas simplificadas). Toda consulta filtra por pertenencia (no miembro = 404 idéntico a inexistente); nombre del grupo, concepto, importes y partes **cifrados**. Rate limits en escrituras, creación e invitaciones.
- **App:** Ajustes → **Gastos compartidos** (`GroupsScreen.jsx`).
- **Fuera de v1** (documentado en el diseño): editar un gasto, salir/expulsar miembros, otras monedas, porcentajes, convertir tu parte en movimiento propio.

## 4. Captura de tickets con IA — hecho
- **Backend:** `POST /api/ticket-scan` (`services/ticket_scan.py`) y `GET /api/ticket-scan/status`. Imagen en base64 (JPG/PNG/WebP, tipo comprobado por los primeros bytes, ≤ ~1 MB, cuerpo ≤ 1,5 MB) → **Gemini (Google), nivel gratuito**, con salida JSON estructurada → importe/comercio/fecha pasados por `parse_importe`/`clean_comercio`/`parse_fecha`. **No guarda nada**: ni la imagen (solo en memoria) ni el resultado; los logs solo llevan el tipo de excepción. Rate limit 3/min, 15/h y 40/día por usuario. Sin `GEMINI_API_KEY` responde 503 y la app lo explica sin ofrecer subir nada.
- **App:** Ajustes → **Escanear ticket**: pantalla de aviso («la foto se envía a un servicio externo, la API de Gemini, de Google») **antes** de poder elegir foto → foto reducida a JPEG en el móvil (quita EXIF/ubicación) → propuesta editable → solo al pulsar «Crear pendiente» se llama a `POST /api/pending` (reutilizado); luego se categoriza con el flujo de pendientes de siempre.
- **IA gratuita:** se usa la API de Gemini con una clave de Google AI Studio **sin facturación asociada**, así que no se puede cobrar nada: si se agota la cuota gratuita, la lectura falla (502) y se puede añadir el gasto a mano. Modelo por defecto `gemini-2.5-flash` (cambiable con `GEMINI_MODEL`). La app avisa de que en el nivel gratuito Google puede usar el contenido enviado para mejorar sus productos. La clave va en cabecera HTTP, nunca en la URL ni en logs.

## Tests ejecutados
- Backend (`pytest`): `test_import_csv`, `test_groups`, `test_ticket_scan`, `test_seed_y_schema`, `test_goals`, `test_hardening_api`, `test_api`, `test_seguridad_bloque_a`, `test_mejoras_revision`, `test_ratelimit` → todos pasan. `test_groups_pg` y `test_goals_pg` (9 + los de metas) contra un **Postgres 16 local desechable**: pasan; además `schema.sql` se aplicó dos veces seguidas en una BD local sin errores (idempotente) y las 5 tablas nuevas quedan con RLS.
- Frontend (`vitest`, solo los relacionados): `csv-import`, `csv-import-pantalla`, `suscripciones`, `suscripciones-pantalla`, `gastos-compartidos`, `gastos-compartidos-pantalla`, `ticket-ia`, `ticket-imagen`, `perfil-panel`, `ajustes-*` (4), `exportar-datos` → todos pasan. `npm run build` correcto.
- No se ha probado con la API real de Gemini (sin clave en este entorno) ni en un móvil real: la parte de cámara/IA está probada con dobles. Conviene una prueba manual en QA.

## A aplicar a mano en QA / producción
1. **Esquema (gastos compartidos).** El backend crea las tablas al arrancar (`ensure_groups_tables`), pero si se prefiere aplicar a mano, es el bloque «Gastos compartidos en grupo» de `backend/schema.sql` (6 tablas `CREATE TABLE IF NOT EXISTS` (incluye `group_guests`) + 4 índices) y estas líneas de RLS:
   ```sql
   ALTER TABLE public.expense_groups        ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.expense_group_members ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.group_guests          ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.group_expenses        ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.group_expense_shares  ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.group_settlements     ENABLE ROW LEVEL SECURITY;
   ```
   Importar CSV, suscripciones y tickets **no** cambian el esquema.
2. **Variables de entorno:** ninguna obligatoria. **`GEMINI_API_KEY`** (clave gratuita de https://aistudio.google.com/apikey, en Render) activa la lectura de tickets; `GEMINI_MODEL` (opcional) fija el modelo. `ANTHROPIC_API_KEY` ya no interviene en los tickets (solo en los emojis de categorías).
3. Recordar que `DB_ENCRYPTION_KEY` debe ser la misma en QA/PROD de cada entorno: los gastos compartidos se cifran con ella.

## Pendiente / a decidir
- Ningún bloque ha quedado en `PENDIENTE-*.md`. Decisiones abiertas menores: si los gastos compartidos deben poder salir de un grupo / generar un movimiento propio; si el importador debe asignar categoría por reglas (hoy todo entra como Gasto Variable).
- IA de tickets: límite por usuario (3/min, 15/h, 40/día) para no agotar la cuota gratuita; sin tope global.

## Nota de privacidad (directorio de usuarios)
Por decisión de producto, cualquier usuario autenticado puede ver el nombre y el email de **todos** los usuarios de la app (para invitarlos desde la propia aplicación). Es razonable para un uso familiar/entre conocidos; si la app se abre a desconocidos, conviene limitarlo (p. ej. solo contactos o búsqueda por email exacto). Tiene rate limit (30/min) y tope de 500 resultados.
