# Diseño: gastos compartidos (a pequeña escala)

Versión mínima estilo Splitwise: un **grupo** de personas ya registradas, **gastos** con quién pagó y cómo se reparte, y el **saldo** «quién debe a quién». Reutiliza el patrón de las metas compartidas (`services/goals.py`, tablas `savings_goal_*`).

## Alcance v1

Sí: crear grupo, añadir personas **eligiéndolas del directorio de usuarios de la app** o, si no tienen cuenta, **solo con un nombre** (invitado), añadir gasto (pagador + reparto a partes iguales o por importes), borrar gasto, registrar un pago entre miembros («liquidar»), ver saldos y deudas simplificadas, borrar el grupo.

No (fuera de v1, documentado para no inventar): editar un gasto (se borra y se vuelve a crear), salir de un grupo / expulsar miembros, varias monedas, porcentajes o participaciones, convertir tu parte en un movimiento propio de «Mi Economía», notificaciones. Quien necesite salir pide al creador que borre el grupo.

## Tablas (backend/schema.sql + `ensure_groups_tables()` al arrancar, idempotentes)

```sql
expense_groups        (id SERIAL PK, nombre_enc BYTEA NOT NULL, created_by TEXT → users ON DELETE CASCADE, created_at)
expense_group_members (group_id → expense_groups ON DELETE CASCADE, user_email → users ON DELETE CASCADE,
                       joined_at, PK (group_id, user_email))
group_guests          (id SERIAL PK, group_id → expense_groups ON DELETE CASCADE, nombre_enc BYTEA, created_by → users, created_at)
group_expenses        (id SERIAL PK, group_id → expense_groups ON DELETE CASCADE, paid_by → users,
                       concepto_enc BYTEA, importe_enc BYTEA, fecha DATE, modo TEXT CHECK IN ('igual','importes'),
                       created_by → users, created_at)
group_expense_shares  (expense_id → group_expenses ON DELETE CASCADE, user_email → users,
                       share_enc BYTEA, PK (expense_id, user_email))
group_settlements     (id SERIAL PK, group_id → expense_groups ON DELETE CASCADE, from_email, to_email → users,
                       importe_enc BYTEA, fecha DATE, created_by → users, created_at)
```

- **Invitados sin cuenta:** su clave de participante es `invitado:<id>`. Por eso `paid_by`, `group_expense_shares.user_email` y `from_email/to_email` de los pagos son `TEXT` sin FK a `users` (pueden ser un email o una clave de invitado; el código comprueba que pertenezca al grupo). Un invitado no puede entrar a la app: los gastos y pagos que le afectan los registran los miembros. Solo se puede quitar si no tiene gastos ni pagos.
- **Cifrado:** nombre del grupo, nombre del invitado, concepto, importe, parte de cada miembro e importe de cada pago van cifrados con `services/crypto.py` (AES-GCM, `DB_ENCRYPTION_KEY`), como `transactions`. `fecha`, ids y emails quedan en claro (hacen falta para ordenar y filtrar). El saldo se calcula en Python tras descifrar, en **céntimos enteros** (sin errores de coma flotante).
- Índices: `group_expenses(group_id)`, `group_settlements(group_id)`, `expense_group_members(user_email)`.
- **RLS:** las 5 tablas con `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` y sin políticas, igual que el resto (el backend es owner).
- Sin datos antiguos que migrar: todas son tablas nuevas; no se toca ninguna existente.

## Permisos (la regla de oro: toda consulta filtra por pertenencia)

| Acción | Quién |
|---|---|
| Listar / ver grupo, gastos, saldos | Solo miembros. Un no miembro recibe **404 idéntico** al de un grupo inexistente (no se filtra que exista). |
| Crear grupo | Cualquier usuario autenticado (máx. 20 grupos creados por usuario). El creador es el primer miembro. |
| Añadir persona con cuenta | Cualquier miembro, eligiéndola de `GET /api/users/directory` (máx. 20 miembros/invitados por grupo). Si no hay cuenta con ese email: 404 claro. **Decisión de producto:** el directorio (nombre + email de todos los usuarios) es visible para cualquier usuario autenticado, con rate limit 30/min. |
| Añadir / quitar invitado sin cuenta | Cualquier miembro; nombre único dentro del grupo. |
| Añadir gasto | Cualquier miembro. El pagador y todos los que reparten deben ser miembros; si no, 422. Máx. 2.000 gastos por grupo. |
| Borrar gasto / pago | Quien lo creó o el creador del grupo. |
| Registrar pago (liquidar) | Entre dos participantes distintos; el que lo registra debe ser el que paga o el que cobra, salvo que ambos sean invitados. |
| Borrar grupo | Solo su creador (cascada). |

Cada función de servicio empieza con `_require_member(group_id, email)` (o filtra con `JOIN expense_group_members … WHERE user_email = %s`) y todas las consultas de gastos/pagos llevan `AND group_id = %s` con el grupo ya verificado: un id de gasto de otro grupo da 404.

## Reparto y saldo

- **Igual:** `participantes` (lista de emails; por defecto todos los miembros). El importe en céntimos se divide entre n; el resto de céntimos va, de uno en uno, a los primeros por orden alfabético de email (determinista, la suma siempre cuadra).
- **Importes:** `partes: {email: importe}`; cada parte > 0 y la **suma debe ser exactamente el total** en céntimos, o 422.
- Importes con `validar_importe` (> 0, ≤ 1.000.000, céntimos), igual que el resto de altas.
- **Saldo por persona** = Σ(lo que pagó) − Σ(su parte) + Σ(pagos que hizo a otros) − Σ(pagos que recibió). Positivo = le deben; negativo = debe.
- **Deudas simplificadas:** algoritmo voraz (el mayor deudor paga al mayor acreedor) → lista `{de, a, importe}` con pocas transferencias.

## Endpoints (todos con JWT; mismo `enforce()` que el resto)

| Método y ruta | Descripción |
|---|---|
| `GET /api/groups` | Grupos del usuario con sus miembros `{id, nombre, creado_por, miembros:[{email,nombre}]}`. |
| `POST /api/groups` `{nombre}` | Crea el grupo. |
| `GET /api/groups/{id}` | Grupo + `gastos` + `pagos` + `saldos` + `deudas`. |
| `DELETE /api/groups/{id}` | Solo el creador. |
| `GET /api/users/directory` | Usuarios con cuenta (sin uno mismo) para elegir a quién invitar. |
| `POST /api/groups/{id}/members` `{email}` | Añade a un usuario con cuenta. |
| `POST /api/groups/{id}/guests` `{nombre}` · `DELETE …/guests/{gid}` | Añade / quita a alguien sin cuenta. |
| `POST /api/groups/{id}/expenses` `{concepto, importe, fecha?, pagado_por?, reparto:{modo:'igual', participantes?} \| {modo:'importes', partes}}` | Añade gasto. |
| `DELETE /api/groups/{id}/expenses/{eid}` | Borra gasto. |
| `POST /api/groups/{id}/settlements` `{de, a, importe, fecha?}` | Registra un pago. |
| `DELETE /api/groups/{id}/settlements/{sid}` | Borra un pago. |

Rate limits: escrituras 60/min y 1.000/día por usuario (`groups-min`, `groups-day`); crear grupo 10/hora; invitar 30/hora y 100/día (`group-invite-*`), directorio 30/min. Cuerpo ≤ 64 KB (tope global). Los 422 son genéricos y no devuelven importes ni textos recibidos; los logs nunca llevan conceptos ni importes. Cada escritura llama a `_broadcast()` como el resto de endpoints mutadores.

## Frontend

Ajustes → **Gastos compartidos** (`GroupsScreen.jsx`): lista de grupos + «Nuevo grupo»; dentro de un grupo: saldos/deudas, lista de gastos, «Añadir gasto» (pagador, importe, concepto, reparto igual o por importes), «Liquidar», invitar por email y borrar. Solo variables CSS de `App.css` (3 temas), ancho móvil.

## Pruebas

- Backend (`tests/test_groups.py`, sin BD real, y `test_groups_pg.py` contra Postgres local si hay `PG_TEST_URL`): reparto y saldo (céntimos, resto), validaciones, **aislamiento entre usuarios** (no miembro → 404 en cada endpoint), permisos de borrado, cifrado en reposo, rate limit, RLS en `schema.sql`.
- Frontend: utilidades de reparto y render de la pantalla.
