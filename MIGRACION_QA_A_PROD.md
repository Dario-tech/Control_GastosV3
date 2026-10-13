# Informe: subir QA a PRODUCCIÓN sin perder ni modificar datos

> Fecha: 2026-10-13 · Estado: **SOLO ANÁLISIS. No se ha ejecutado nada en producción.**
> Elaborado con los agentes `backend`, `frontal` e `infra`, más comprobaciones de solo lectura
> en Supabase (PROD y QA) y Vercel.

---

## 1. Resumen ejecutivo

| | |
|---|---|
| **¿Es viable?** | **Sí**, pero **hoy NO se puede subir tal cual**. Hay 4 bloqueantes, y todos tienen solución sin perder datos. |
| **Git** | `qa` va 75 commits por delante de `main`, y `main` no tiene commits propios. El merge es *fast-forward* y no tiene conflictos. Cambian 142 ficheros (+15 472 / −6 295). |
| **Datos en servidor (PROD)** | 2 usuarios, 255 transacciones (jul–oct 2026), 3 pendientes, 2 tokens de Atajo y la tabla `categories` (34 filas, ver §4.4). |
| **Datos en el móvil (localStorage)** | Las categorías propias de Julia, los presupuestos, los ajustes y el tema **solo existen en el móvil**. No hay ninguna copia en el servidor. |
| **Riesgo principal** | Si se despliega sin las correcciones, el frontend de QA **borra las categorías propias y los presupuestos de localStorage** en cuanto la sesión da 401. Eso pasará seguro el día de la subida si cambia `JWT_SECRET`. |

### Los 4 bloqueantes

| # | Problema | Efecto si se sube así | Solución |
|---|---|---|---|
| **B1** | QA solo lee las columnas cifradas `concepto_enc` / `importe_enc`. En PROD no existen y los datos están en claro. | **Historial vacío** para todos, sin ningún error visible. | Ejecutar `migrate_encrypt_existing.py`. Solo **añade** columnas cifradas; no cambia las columnas en claro. |
| **B2** | En PROD `transactions.concepto` e `importe` son `NOT NULL` **sin DEFAULT** (comprobado). QA ya no escribe esas columnas. | **Error 500 en cada gasto nuevo** y en cada pendiente categorizado. | `ALTER ... SET DEFAULT ''` / `SET DEFAULT 0`. Es mejor que `DROP NOT NULL` (ver §5). Mejor aún: doble escritura (§3.2). |
| **B3** | QA no arranca si `JWT_SECRET` falta o tiene el valor por defecto (`backend/services/auth.py:11-17`). Es probable que PROD use hoy el valor por defecto. | El deploy en Render falla. Render sigue sirviendo la versión vieja, así que no hay caída, pero tampoco hay subida. | Poner un `JWT_SECRET` nuevo. Consecuencia: todos tienen que volver a iniciar sesión una vez, lo que **dispara B4**. |
| **B4** | `clearUserData()` (`controlGastosMovil/src/utils/storageKeys.js`) se llama en `logout()` y **ante cualquier 401** (`AuthContext.jsx:37`, `:108`). Borra `mi-economia-custom-cats-v1` y `mi-economia-budget-v1/v2/v3`. | **Se pierden para siempre las categorías locales de Julia y todos los presupuestos.** En `main` un 401 no borraba nada. | Sacar categorías y presupuestos de `USER_DATA_KEYS`, o al menos no borrar nada ante un 401 (§3.1). **Requisito previo obligatorio.** |

---

## 2. Qué se conserva y qué cambia para el usuario

### 2.1 localStorage: inventario `main` → `qa`

Todas las claves de `main` **siguen existiendo con el mismo nombre y formato** en `qa`. No hay renombres, así que no hace falta migrar localStorage. Solo hay que evitar que se borren.

| Clave | En `main` | En `qa` | ¿Se conserva al actualizar? |
|---|---|---|---|
| `mi-economia-custom-cats-v1` (categorías propias de Julia) | ✔ | ✔ mismo formato `{ 'Gasto Variable': [...], 'Gasto Fijo': [...], 'Ingreso': [...] }` | ✔ al actualizar · ✘ **se borra con logout o 401 (B4)** |
| `mi-economia-budget-v3` (y v1, v2) | ✔ | ✔ | ✔ al actualizar · ✘ **se borra con logout o 401 (B4)** |
| `mi-economia-settings-v1` (tema, acento, moneda, ocultar importes, alertas) | ✔ | ✔ y añade 4 temas nuevos; los valores antiguos (`dark`/`light`/`pastel`) siguen siendo válidos | ✔ siempre |
| `mi-economia-cal-open` | ✔ | ✔ | ✔ siempre |
| `mi-economia-notif-v1` | ✔ | ✔ | se borra con logout o 401. Solo son avisos ya enviados, sin impacto |
| `mi-economia-finance-cache-v1` | ✔ | ✔ | se borra con logout o 401. Es una caché y se vuelve a descargar del servidor |
| `mi-economia-auth-v1` | ✔ | ✔ | se borra al cambiar `JWT_SECRET`, así que hay que volver a iniciar sesión una vez |
| `mi-economia-tour-v1`, `-annual-notif-v1`, `-shortcut-queue-v1` | — | nuevas | — |

**Origen (dominio):** localStorage está ligado al dominio. PROD es `control-gastos-v3.vercel.app` (proyecto Vercel `control-gastos-v3`, rama `main`). **Hay que desplegar en ese mismo proyecto y dominio.** Si se usa otro, el usuario no vería nada de lo guardado en el móvil.

**PWA:** `registerType: 'autoUpdate'`. La app instalada en iOS se actualiza al reabrirla, y el localStorage se conserva porque el dominio es el mismo.

### 2.2 ¿Se verán TODAS las transacciones y categorías?

- **Transacciones:** sí, siempre que se haga B1. Las listas, gráficos y estadísticas agrupan por el texto `concepto` de cada transacción, no por la lista de categorías. Una transacción con una categoría propia de Julia se ve aunque esa categoría no esté en la lista por defecto.
- **Categorías propias de Julia:** se leen de la misma clave (`SettingsContext.jsx`), y se combinan con las de por defecto en el selector de categoría, en presupuestos, en categorizar y en editar. PROD tiene 17 conceptos distintos en Gasto Variable frente a 7 por defecto, así que hay al menos unas 10 categorías propias en uso que dependen de localStorage.
- **⚠ Categoría por defecto renombrada:** `Netflix&Dazn&Regalos` pasa a llamarse `Suscripciones` (`src/data/categories.js`). En PROD hay **6 transacciones** con el nombre antiguo.
  - Se siguen viendo con su nombre original. No se pierde nada.
  - Pero esa categoría desaparece del selector, y un presupuesto que exista para ella se queda sin categoría.
  - **Recomendación:** mantener `Netflix&Dazn&Regalos` en la lista por defecto durante esta subida. **No** renombrar datos en la BD.
- **Julia:** `HIDDEN_CATEGORIES_BY_USER` le oculta `Inversiones` y `Cripto` del selector (comportamiento intencionado, ya presente).

### 2.3 Lo que el usuario sí notará

- Interfaz nueva: rediseño, 7 temas, tour, calendario, metas de ahorro, gastos fijos anuales, búsqueda, editar movimientos y Atajo de Apple Pay.
- **Tendrá que volver a iniciar sesión una vez** (por el nuevo `JWT_SECRET`).
- **Pestaña Año:** el backend nuevo calcula los totales del **año en curso** (`/api/finance?year=`); antes sumaba todos los años en los 12 meses. Hoy solo hay datos de 2026, así que **las cifras no cambian**.

---

## 3. Cambios de código necesarios ANTES de subir (en `qa`, sin tocar PROD)

### 3.1 Frontend: proteger localStorage (B4). Obligatorio
1. En `src/utils/storageKeys.js`, sacar de `USER_DATA_KEYS` estas claves: `CUSTOM_CATS_KEY`, `BUDGET_KEY`, `BUDGET_KEY_V2` y `BUDGET_KEY_V1`.
   - Si se quiere mantener el borrado en un logout *voluntario* en móviles compartidos, que sea opcional y con confirmación explícita.
   - **Nunca** ante un 401.
2. En `AuthContext.jsx` (`handleExpired`), ante un 401 borrar **solo** `AUTH_KEY` y `FINANCE_CACHE_KEY`.
3. Mantener `Netflix&Dazn&Regalos` en `DEFAULT_CATEGORIES`, o añadirlo como alias.
4. Añadir un test (vitest) que compruebe que tras un 401 y tras un logout siguen estando `custom-cats-v1` y `budget-v3`.

### 3.2 Backend: rollback seguro y verificación
1. **Doble escritura temporal:** que `post_transaction`, `categorize_pending` y `update_transaction` escriban **también** `concepto` e `importe` en claro, además de las columnas cifradas.
   - Resuelve B2 sin tocar el esquema.
   - Hace que volver a la versión de `main` funcione sin sincronizar nada.
   - Se quita cuando se borren las columnas en claro (fase posterior).
2. `migrate_encrypt_existing.py:57` y `:62` imprimen concepto e importe en claro si la verificación falla. Deben imprimir solo el `id`.
3. Comprobar `CORS_ORIGINS`: el valor por defecto del código es `control-beta-ten.vercel.app` (QA), **no** el dominio de PROD. En Render de PROD tiene que valer exactamente `https://control-gastos-v3.vercel.app`.

---

## 4. Base de datos de PROD: estado real y cambios

### 4.1 Estado actual (consultado en solo lectura)

| Tabla | Filas | Columnas | RLS |
|---|---|---|---|
| `users` | 2 | email, name, created_at, shortcut_token | ✘ |
| `transactions` | 255 | id, user_email, fecha, tipo, concepto (NOT NULL, sin default), importe (numeric, NOT NULL, sin default), created_at | ✔, sin políticas, y el backend funciona, así que su rol se salta RLS |
| `pending_transactions` | 3 | id, user_email, importe, fecha, created_at | ✘ |
| `categories` | 34 (17 por usuario) | id, user_email, tipo, concepto, emoji | ✘ |

### 4.2 Cambios que aplica QA al arrancar (todos aditivos e idempotentes)
Los aplican las funciones `ensure_*` del `lifespan` (`backend/main.py:57-67`). **Ninguno hace UPDATE ni DELETE de datos existentes:**
- `users.password_hash` (NULL para usuarios de Google)
- `transactions.comentario`, `transactions.concepto_enc` y `transactions.importe_enc`, más el índice `idx_transactions_search`
- `pending_transactions.comercio_enc`, `comercio_hmac`, `fuente` e `id_externo_hmac`, más un índice
- tablas nuevas: `savings_goals`, `savings_goal_members`, `savings_goal_contributions`, `annual_fixed_expenses` y `merchant_rules`

**No** hay que ejecutar `backend/schema.sql` contra PROD: está pensado para una BD vacía y no migra nada.

### 4.3 Migración de cifrado (`migrate_encrypt_existing.py`)
- Rellena `concepto_enc` e `importe_enc` solo en las filas con `concepto_enc IS NULL`. Es **idempotente**: se puede repetir.
- **No modifica** `concepto`, `importe`, `tipo` ni `fecha`.
- Hace un único commit; si algo falla, deshace todo. Comprobado en PROD: ningún `concepto` ni `importe` es NULL, e `importe` es `numeric`, así que no debería fallar.
- **Hay que lanzarlo con las escrituras paradas** y otra vez justo antes del corte.

### 4.4 Tabla `categories` de PROD
**Ni `main` ni `qa` la usan en el código.** Es un resto de una versión anterior: las categorías reales están en localStorage. **No se toca:** se queda como está, como copia de referencia.

### 4.5 RLS (recomendado, no bloqueante)
Supabase avisa de que `users`, `categories` y `pending_transactions` están **sin RLS**: cualquiera con la clave *anon* podría leerlas o escribirlas por la API REST. El backend ya funciona con RLS activo en `transactions`, así que activarlo en las demás no lo rompe:
```sql
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_transactions ENABLE ROW LEVEL SECURITY;
```
Activar RLS no cambia ningún dato. Es solo un permiso.

---

## 5. Plan de ejecución paso a paso (pendiente de tu OK)

### Fase 0: preparación (sin tocar PROD)
1. Implementar §3.1 y §3.2 en `qa`, desplegar en QA y validar.
2. **Ensayo general:** restaurar un `pg_dump` de PROD en una BD desechable (Postgres local de `docker-compose.local.yml` o un proyecto Supabase temporal, **nunca en QA**). Ejecutar la migración y arrancar el backend de `qa` contra esa copia. Comprobar que los totales por mes coinciden con la app actual.
3. **Ensayo de localStorage de Julia:**
   - En el móvil de Julia, abrir Safari → app → consola remota (Mac → Safari → Desarrollo → iPhone). Ejecutar `copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage))))` y guardar el JSON. Es la **copia de seguridad del móvil**.
   - Inyectar ese JSON en el navegador contra la copia del ensayo y comprobar que aparecen sus categorías con sus emojis, sus presupuestos y todas las transacciones.
   - Hacer lo mismo con el otro usuario.
4. Generar una `DB_ENCRYPTION_KEY` **nueva y propia de PROD** (`backend/services/crypto.py` explica cómo) y un `JWT_SECRET` nuevo. Guardar los dos en un gestor de contraseñas. **Si se pierde la clave de cifrado, los datos cifrados son irrecuperables.** Nunca reutilizar la de QA ni la de `docker-compose.local.yml`.

### Fase 1: ventana de mantenimiento (unos 30 min; avisar de que no se registren gastos)
1. **Copia de seguridad del móvil** (paso 0.3) de cada usuario, por si acaso.
2. **Suspender** el servicio de Render de PROD, para que no haya escrituras ni Atajo.
3. **Backup de la BD** (desde un equipo con `pg_dump` ≥ 17, sin escribir la contraseña en el historial):
   ```bash
   umask 077; read -rs PROD_DB_URL; export PROD_DB_URL
   pg_dump "$PROD_DB_URL" -Fc --no-owner --no-privileges -n public -f prod_$(date +%Y%m%d_%H%M).dump
   pg_restore -l prod_*.dump | grep -c "TABLE DATA"
   gpg -c prod_*.dump && shred -u prod_*.dump; unset PROD_DB_URL
   ```
   El plan gratuito de Supabase no tiene PITR. **Esta copia es la red de seguridad.**
4. **Foto "ANTES"** (solo lectura):
   ```sql
   SELECT 'users',count(*) FROM users UNION ALL SELECT 'tx',count(*) FROM transactions
   UNION ALL SELECT 'pending',count(*) FROM pending_transactions UNION ALL SELECT 'categories',count(*) FROM categories;
   SELECT user_email, count(*), sum(importe) FROM transactions GROUP BY 1 ORDER BY 1;
   SELECT md5(string_agg(id||'|'||user_email||'|'||fecha||'|'||tipo||'|'||concepto||'|'||importe, ',' ORDER BY id)) FROM transactions;
   SELECT md5(string_agg(id||'|'||user_email||'|'||importe||'|'||fecha, ',' ORDER BY id)) FROM pending_transactions;
   SELECT md5(string_agg(email||'|'||name||'|'||coalesce(shortcut_token,''), ',' ORDER BY email)) FROM users;
   SELECT md5(string_agg(id||'|'||user_email||'|'||tipo||'|'||concepto||'|'||emoji, ',' ORDER BY id)) FROM categories;
   ```
5. **DDL aditivo** (si no hay doble escritura, §3.2):
   `ALTER TABLE transactions ALTER COLUMN concepto SET DEFAULT '', ALTER COLUMN importe SET DEFAULT 0;`
   Solo cambia metadatos y no reescribe filas. Opcional: RLS (§4.5).
6. **Cifrado:** `DATABASE_URL=… DB_ENCRYPTION_KEY=… python backend/migrate_encrypt_existing.py`. Tiene que terminar en "Verificación OK"; al relanzarlo debe procesar 0 filas.
7. **Foto "DESPUÉS":** repetir el paso 4. **Todos los conteos, sumas y md5 deben ser idénticos**, lo que demuestra que no se ha modificado nada. Además: `SELECT count(*) FROM transactions WHERE concepto_enc IS NULL;` debe dar 0.
8. **Render (PROD):** añadir `JWT_SECRET`, `DB_ENCRYPTION_KEY` (la misma del paso 6) y `CORS_ORIGINS=https://control-gastos-v3.vercel.app`, y revisar `GOOGLE_CLIENT_ID`. Health check: `/api/health`.
9. **Pausar el autodeploy de Vercel** (Ignored Build Step = `exit 0`), para que el frontend nuevo no llegue antes que el backend.
10. `git checkout main && git merge --ff-only origin/qa && git push`. Reactivar Render y esperar a que esté **Live**. Comprobar `/api/health` y `/api/finance` con un usuario real.
11. Reactivar Vercel y desplegar en producción en el **mismo proyecto y dominio**.

### Fase 2: validación (con Julia y el otro usuario)
- [ ] Volver a iniciar sesión (una vez). **Las categorías propias siguen ahí** (Ajustes → categorías y selector al añadir un gasto).
- [ ] Presupuestos, tema y ajustes iguales que antes.
- [ ] Totales de Año y Mes iguales a la foto "ANTES". Las 255 transacciones visibles, incluidas las 6 de `Netflix&Dazn&Regalos`.
- [ ] Crear, editar y borrar un gasto de prueba. Comprobar que se actualiza en el otro móvil (SSE).
- [ ] El Atajo de iOS sigue funcionando: el token no cambia.
- [ ] Los 3 pendientes siguen en la campana.
- [ ] El log de Render no muestra "No se pudo descifrar la transacción".

### Fase 3: más adelante (otra decisión, con un nuevo backup)
Tras 2-4 semanas estables: quitar la doble escritura y borrar `concepto` e `importe` en claro (`DROP COLUMN`). Hasta entonces el cifrado "en reposo" no protege del todo, y los backups siguen conteniendo datos en claro.

---

## 6. Rollback

| Nivel | Acción | Pérdida |
|---|---|---|
| Frontend | Vercel → deployment anterior → *Promote to Production* (instantáneo) | Ninguna. localStorage intacto si se aplicó §3.1 |
| Backend | Render → deploy anterior → *Rollback* | Ninguna **con doble escritura** (§3.2). Sin ella, las altas nuevas tienen `''`/`0` en claro y la app vieja las mostraría mal |
| Esquema | Nada que deshacer: todo es aditivo y el código viejo ignora las columnas y tablas nuevas | — |
| Desastre | `pg_restore` del dump del paso 1.3 (con el backend parado) | Lo escrito después del backup |
| Móvil | Restaurar el JSON del paso 0.3 en la consola de Safari (`localStorage.setItem(...)`) | Ninguna |

---

## 7. Otros riesgos (no bloqueantes)

| Gravedad | Riesgo |
|---|---|
| Media | `TRUSTED_PROXY_HOPS` (por defecto 2) puede no coincidir con Render. Hay que revisarlo para que el límite de intentos de login no sea compartido por todos. |
| Media | `/api/events` (SSE) sin autenticación (solo envía `"data_updated"`, sin datos). |
| Baja | Arranque en frío de Render. El keep-alive de GitHub Actions es frágil. Las 750 h gratis no alcanzan para PROD y QA despiertos a la vez. |
| Baja | `anthropic`, `cryptography` y `tzdata` sin versión fija en `requirements.txt`. |
| Baja | `jsdom@29` (solo para tests) pide Node ≥ 20.19 en Vercel. |
| Info | `render.yaml` todavía declara `APPS_SCRIPT_URL`, que ya no se usa. |

---

## 8. Decisiones que necesito de ti
1. ¿OK a implementar §3.1 (proteger categorías y presupuestos en localStorage) y §3.2 (doble escritura y arreglos menores) en `qa`?
2. ¿Mantengo `Netflix&Dazn&Regalos` como categoría por defecto o prefieres `Suscripciones` con alias?
3. ¿Activamos RLS en `users`, `categories` y `pending_transactions` durante la subida?
4. ¿Confirmas si el Render de PROD tiene hoy un `JWT_SECRET` propio? Si lo tiene y se mantiene, nadie tendrá que volver a iniciar sesión.
5. Fecha y hora de la ventana de mantenimiento.
