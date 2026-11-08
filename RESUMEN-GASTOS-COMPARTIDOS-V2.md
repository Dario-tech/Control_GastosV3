# Resumen: gastos compartidos v2 (enfoque A «Dividir»)

Rama `feat/gastos-compartidos-integrados` (sale de `qa`, sin merge ni PR). Decisiones del usuario: enfoque A; comparte sobre todo con **gente sin la app**; en su economía cuenta **lo que pagó** (60 € de una cena, no 20 €); quiere **repartir por líneas del ticket**.

## Cómo funciona
- «Añadir gasto» → interruptor **Dividir con otras personas** (no en ingresos): elige/crea personas (solo un nombre, sin cuenta), quién pagó, reparto igual o por importes, etiqueta opcional (viaje, piso…).
- Se crea **un movimiento normal** (con lo que pagaste; si pagó otra persona, tu parte) **y** el reparto, en una sola transacción de BD. Mes/Año/presupuestos/estadísticas no cambian: leen el movimiento de siempre.
- En Mes: botón **Cuentas** (saldo total) → saldo por persona, gastos, liquidaciones. En el detalle de movimientos sale `👥 te deben X`.
- **Liquidar** («Me ha pagado» / «Le he pagado») **no** crea ingreso ni gasto; solo cierra la deuda. Borrar el movimiento en Mes borra su reparto (cascada); borrar un reparto desde Cuentas borra también su movimiento.
- Retirado: pantalla de Ajustes, `GroupsScreen.jsx`, endpoints `/api/groups…` y `/api/users/directory`. `services/groups.py` queda solo con las funciones puras de reparto.

## A aplicar a mano (QA y producción)
Nada es obligatorio: el backend crea las tablas al arrancar (idempotente). Si prefieres aplicarlo tú, ejecuta el bloque «Gastos compartidos INTEGRADOS» de `backend/schema.sql` (4 tablas `shared_*`, índices y `ENABLE ROW LEVEL SECURITY` sin políticas). Sin variables de entorno nuevas.
Opcional, cuando quieras limpiar QA: las tablas antiguas `expense_groups`, `expense_group_members`, `group_guests`, `group_expenses`, `group_expense_shares`, `group_settlements` ya no se usan (`DROP TABLE … CASCADE`; se conservan por si hubiera datos de prueba).

## Garantías mantenidas
Toda consulta filtra por `user_email` (test estático + test contra Postgres real: otro usuario recibe 404/422 y no ve nada); nombres, totales y partes cifrados con `services/crypto.py`; RLS sin políticas; rate limits `shared-min/day`; 422 genéricos sin eco; alta idempotente por `id_cliente`.

## Límites conocidos / pendiente
- **Editar el importe** de un movimiento compartido no recalcula el reparto (borra y vuelve a crear).
- Un gasto compartido **no se encola offline**: sin conexión muestra el error (el normal sí).
- **Repartir por líneas del ticket**: no hecho; depende de la otra sesión (`/api/ticket-scan` devolviendo `[{descripcion, importe}]`). El backend ya acepta `reparto.modo = "importes"`, así que bastará calcular las partes por persona en el cliente.
- Importar saldos desde Splitwise/Tricount: no pedido, sin hacer.

## Pruebas
`backend`: `pytest tests/test_shared.py tests/test_groups.py` (+ `PG_TEST_URL=… pytest tests/test_shared_pg.py` con Postgres local). Suite completa del backend: 1191 pasan. `frontend`: `npx vitest run tests/gastos-compartidos-integrados.test.jsx`.
