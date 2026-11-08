# Diseño: gastos compartidos (a pequeña escala)

Versión mínima estilo Splitwise: un **grupo** de personas ya registradas, **gastos** con quién pagó y cómo se reparte, y el **saldo** «quién debe a quién». Reutiliza el patrón de las metas compartidas (`services/goals.py`, tablas `savings_goal_*`).

## Alcance v1

Sí: crear grupo, invitar por email (solo cuentas existentes), añadir gasto (pagador + reparto a partes iguales o por importes), borrar gasto, registrar un pago entre miembros («liquidar»), ver saldos y deudas simplificadas, borrar el grupo.

No (fuera de v1, documentado para no inventar): editar un gasto (se borra y se vuelve a crear), salir de un grupo / expulsar miembros, varias monedas, porcentajes o participaciones, convertir tu parte en un movimiento propio de «Mi Economía», notificaciones. Quien necesite salir pide al creador que borre el grupo.

## Tablas (backend/schema.sql + `ensure_groups_tables()` al arrancar, idempotentes)

```sql
expense_groups        (id SERIAL PK, nombre_enc BYTEA NOT NULL, created_by TEXT → users ON DELETE CASCADE, created_at)
expense_group_members (group_id → expense_groups ON DELETE CASCADE, user_email → users ON DELETE CASCADE,
                       joined_at, PK (group_id, user_email))
group_expenses        (id SERIAL PK, group_id → expense_groups ON DELETE CASCADE, paid_by → users,
                       concepto_enc BYTEA, importe_enc BYTEA, fecha DATE, modo TEXT CHECK IN ('igual','importes'),
                       created_by → users, created_at)
group_expense_shares  (expense_id → group_expenses ON DELETE CASCADE, user_email → users,
                       share_enc BYTEA, PK (expense_id, user_email))
group_settlements     (id SERIAL PK, group_id → expense_groups ON DELETE CASCADE, from_email, to_email → users,
                       importe_enc BYTEA, fecha DATE, created_by → users, created_at)
```

- **Cifrado:** nombre del grupo, concepto, importe, parte de cada miembro e importe de cada pago van cifrados con `services/crypto.py` (AES-GCM, `DB_ENCRYPTION_KEY`), como `transactions`. `fecha`, ids y emails quedan en claro (hacen falta para ordenar y filtrar). El saldo se calcula en Python tras descifrar, en **céntimos enteros** (sin errores de coma flotante).
- Índices: `group_expenses(group_id)`, `group_settlements(group_id)`, `expense_group_members(user_email)`.
- **RLS:** las 5 tablas con `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` y sin políticas, igual que el resto (el backend es owner).
- Sin datos antiguos que migrar: todas son tablas nuevas; no se toca ninguna existente.

## Permisos (la regla de oro: toda consulta filtra por pertenencia)

| Acción | Quién |
|---|---|
| Listar / ver grupo, gastos, saldos | Solo miembros. Un no miembro recibe **404 idéntico** al de un grupo inexistente (no se filtra que exista). |
| Crear grupo | Cualquier usuario autenticado (máx. 20 grupos creados por usuario). El creador es el primer miembro. |
| Invitar por email | Cualquier miembro (máx. 20 miembros por grupo). Respuesta **neutra** exista o no la cuenta (no permite enumerar emails), como `share_goal`. |
| Añadir gasto | Cualquier miembro. El pagador y todos los que reparten deben ser miembros; si no, 422. Máx. 2.000 gastos por grupo. |
| Borrar gasto / pago | Quien lo creó o el creador del grupo. |
| Registrar pago (liquidar) | Un miembro, entre dos miembros distintos, y el que lo registra debe ser el que paga o el que cobra. |
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
| `POST /api/groups/{id}/members` `{email}` | Invita (respuesta neutra). |
| `POST /api/groups/{id}/expenses` `{concepto, importe, fecha?, pagado_por?, reparto:{modo:'igual', participantes?} \| {modo:'importes', partes}}` | Añade gasto. |
| `DELETE /api/groups/{id}/expenses/{eid}` | Borra gasto. |
| `POST /api/groups/{id}/settlements` `{de, a, importe, fecha?}` | Registra un pago. |
| `DELETE /api/groups/{id}/settlements/{sid}` | Borra un pago. |

Rate limits: escrituras 60/min y 1.000/día por usuario (`groups-min`, `groups-day`); crear grupo 10/hora; invitar 10/hora y 30/día (`group-invite-*`, como `share-*`). Cuerpo ≤ 64 KB (tope global). Los 422 son genéricos y no devuelven importes ni textos recibidos; los logs nunca llevan conceptos ni importes. Cada escritura llama a `_broadcast()` como el resto de endpoints mutadores.

## Frontend

Ajustes → **Gastos compartidos** (`GroupsScreen.jsx`): lista de grupos + «Nuevo grupo»; dentro de un grupo: saldos/deudas, lista de gastos, «Añadir gasto» (pagador, importe, concepto, reparto igual o por importes), «Liquidar», invitar por email y borrar. Solo variables CSS de `App.css` (3 temas), ancho móvil.

## Pruebas

- Backend (`tests/test_groups.py`, sin BD real, y `test_groups_pg.py` contra Postgres local si hay `PG_TEST_URL`): reparto y saldo (céntimos, resto), validaciones, **aislamiento entre usuarios** (no miembro → 404 en cada endpoint), permisos de borrado, cifrado en reposo, rate limit, RLS en `schema.sql`.
- Frontend: utilidades de reparto y render de la pantalla.
