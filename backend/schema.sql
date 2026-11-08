-- ─────────────────────────────────────────────────────────────────────────────
-- Esquema completo de la base de datos — Control Gastos
-- Idempotente: se puede ejecutar en una BD nueva (QA) o re-ejecutar sin romper nada.
-- Reconstruido a partir de las queries del backend (services/*.py).
-- ─────────────────────────────────────────────────────────────────────────────

-- Usuarios. Los de Google tienen password_hash = NULL; los de email lo tienen.
CREATE TABLE IF NOT EXISTS users (
    email          TEXT PRIMARY KEY,
    name           TEXT NOT NULL DEFAULT '',
    shortcut_token TEXT UNIQUE,
    password_hash  TEXT
);

-- Transacciones confirmadas. concepto e importe van cifrados en reposo
-- (AES-256-GCM, ver backend/services/crypto.py) — solo el backend, con la
-- clave DB_ENCRYPTION_KEY, puede leerlos. tipo y fecha quedan en claro
-- (tipo solo tiene 3 valores; fecha hace falta para filtrar por rango).
CREATE TABLE IF NOT EXISTS transactions (
    id           SERIAL PRIMARY KEY,
    user_email   TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    fecha        DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo         TEXT NOT NULL DEFAULT '',
    concepto_enc BYTEA NOT NULL,
    importe_enc  BYTEA NOT NULL,
    comentario   TEXT,  -- OBSOLETA (notas antiguas en claro); se vacía al migrar a comentario_enc
    comentario_enc BYTEA  -- nota libre opcional, cifrada como concepto/importe
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_email);
-- Paginación de la búsqueda por (usuario, fecha, id) sin escanear toda la tabla.
CREATE INDEX IF NOT EXISTS idx_transactions_search ON transactions(user_email, fecha DESC, id DESC);

-- Idempotencia del alta: id opcional generado por el cliente (UUID). Un reintento con
-- el mismo (usuario, id_cliente) no duplica el movimiento. Índice único PARCIAL.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS id_cliente TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_user_id_cliente
    ON transactions(user_email, id_cliente) WHERE id_cliente IS NOT NULL;

-- Pagos pendientes de categorizar (llegan del Atajo iOS con importe + fecha,
-- y desde el Atajo de Cartera/Apple Pay también con comercio).
-- comercio_enc: comercio cifrado (AES-GCM); comercio_hmac / id_externo_hmac:
-- HMAC-SHA256 con subclave derivada de DB_ENCRYPTION_KEY (crypto.hmac_tag), para
-- detectar duplicados y buscar reglas por igualdad sin guardar el texto en claro.
-- fuente: 'wallet' | 'atajo' | NULL (creado desde la app o antes de existir la columna).
CREATE TABLE IF NOT EXISTS pending_transactions (
    id              SERIAL PRIMARY KEY,
    user_email      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    importe         NUMERIC(12,2),          -- LEGADO en claro: NULL en filas nuevas (ver importe_enc)
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    importe_enc     BYTEA,                  -- importe cifrado (AES-GCM, encrypt_float)
    importe_hmac    BYTEA,                  -- HMAC del importe en céntimos (dedup por igualdad)
    comercio_enc    BYTEA,
    comercio_hmac   BYTEA,
    fuente          TEXT,
    id_externo_hmac BYTEA
);
-- Migración aditiva para BDs creadas antes del Atajo de Cartera (idempotente).
ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS comercio_enc    BYTEA;
ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS comercio_hmac   BYTEA;
ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS fuente          TEXT;
ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS id_externo_hmac BYTEA;
ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS importe_enc     BYTEA;
ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS importe_hmac    BYTEA;
ALTER TABLE pending_transactions ALTER COLUMN importe DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_transactions(user_email);
CREATE INDEX IF NOT EXISTS idx_pending_user_created ON pending_transactions(user_email, created_at DESC);

-- Reglas aprendidas comercio → categoría (al confirmar un pendiente con
-- "recordar"). El comercio solo se guarda como HMAC del nombre normalizado;
-- la categoría (concepto) va cifrada como en transactions.
CREATE TABLE IF NOT EXISTS merchant_rules (
    user_email    TEXT REFERENCES users(email) ON DELETE CASCADE,
    comercio_hmac BYTEA,
    tipo          TEXT,
    concepto_enc  BYTEA,
    hits          INT NOT NULL DEFAULT 1,
    updated_at    TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_email, comercio_hmac)
);

-- Metas de ahorro, compartibles entre usuarios. El total ahorrado es la suma
-- de las contribuciones de todos los miembros, no un campo fijo.
CREATE TABLE IF NOT EXISTS savings_goals (
    id         SERIAL PRIMARY KEY,
    nombre     TEXT NOT NULL,
    objetivo   NUMERIC(12,2) NOT NULL,
    emoji      TEXT NOT NULL DEFAULT '🎯',
    imagen_url TEXT,  -- gif/imagen personalizada, alternativa al emoji
    fecha      DATE,
    created_by TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS savings_goal_members (
    goal_id    INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (goal_id, user_email)
);

CREATE TABLE IF NOT EXISTS savings_goal_contributions (
    id         SERIAL PRIMARY KEY,
    goal_id    INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    importe    NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    foto       TEXT  -- opcional: data-URL JPEG comprimida en cliente ("álbum de recuerdos")
);

-- Índices para listar metas/aportaciones sin recorrer la tabla (idempotentes).
CREATE INDEX IF NOT EXISTS idx_goal_contrib_goal ON savings_goal_contributions(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_members_user ON savings_goal_members(user_email);

-- Gastos fijos anuales (IBI, seguro del coche…). meses_reparto: meses concretos
-- (1-12) en los que se reparte el importe; importe / len(meses_reparto) es lo
-- que se sugiere apartar cada uno de esos meses, y aparece como gasto fijo
-- estimado en la pestaña Mes.
CREATE TABLE IF NOT EXISTS annual_fixed_expenses (
    id            SERIAL PRIMARY KEY,
    user_email    TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    nombre        TEXT NOT NULL,
    importe       NUMERIC(12,2) NOT NULL,
    mes           INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    dia           INTEGER NOT NULL DEFAULT 1 CHECK (dia BETWEEN 1 AND 31),
    meses_reparto INTEGER[],
    avisar        BOOLEAN NOT NULL DEFAULT true,
    dias_aviso    INTEGER NOT NULL DEFAULT 15,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_annual_exp_user ON annual_fixed_expenses(user_email);

-- Categorías propias de cada usuario (nombre cifrado; unicidad por HMAC del
-- nombre normalizado). OJO: no confundir con la tabla antigua `categories`.
CREATE TABLE IF NOT EXISTS user_categories (
    id            BIGSERIAL PRIMARY KEY,
    user_email    TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    tipo          TEXT NOT NULL CHECK (tipo IN ('Gasto Variable', 'Gasto Fijo', 'Ingreso')),
    concepto_enc  BYTEA NOT NULL,
    concepto_hmac BYTEA NOT NULL,
    emoji         TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_email, tipo, concepto_hmac)
);

-- Preferencias por usuario (settings, budgets, hidden_categories, tour): el
-- JSON entero va cifrado con AES-GCM.
CREATE TABLE IF NOT EXISTS user_prefs (
    user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    data_enc   BYTEA NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_email, kind)
);

-- Sesiones revocadas (POST /api/auth/logout): jti del JWT y su caducidad. Aditiva e
-- idempotente; el backend también la crea al arrancar (ensure_revoked_sessions_table)
-- y la carga en memoria. Las filas caducadas se borran al arrancar.
CREATE TABLE IF NOT EXISTS revoked_sessions (
    jti TEXT PRIMARY KEY,
    exp TIMESTAMPTZ NOT NULL
);

-- Gastos compartidos en grupo (ver docs-diseno-gastos-compartidos.md). Nombre del
-- grupo, concepto, importes y partes van CIFRADOS (AES-GCM, services/crypto.py).
-- Aditivo e idempotente; el backend también lo crea al arrancar (ensure_groups_tables).
CREATE TABLE IF NOT EXISTS expense_groups (
    id         SERIAL PRIMARY KEY,
    nombre_enc BYTEA NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_group_members (
    group_id   INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_email)
);

-- Personas SIN cuenta, solo con un nombre (cifrado). Su clave de participante es 'invitado:<id>'.
CREATE TABLE IF NOT EXISTS group_guests (
    id         SERIAL PRIMARY KEY,
    group_id   INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    nombre_enc BYTEA NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_expenses (
    id           SERIAL PRIMARY KEY,
    group_id     INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    paid_by      TEXT NOT NULL,  -- email de un miembro o 'invitado:<id>'
    concepto_enc BYTEA NOT NULL,
    importe_enc  BYTEA NOT NULL,
    fecha        DATE NOT NULL,
    modo         TEXT NOT NULL CHECK (modo IN ('igual', 'importes')),
    created_by   TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_expense_shares (
    expense_id INTEGER NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,  -- email de un miembro o 'invitado:<id>'
    share_enc  BYTEA NOT NULL,
    PRIMARY KEY (expense_id, user_email)
);

CREATE TABLE IF NOT EXISTS group_settlements (
    id          SERIAL PRIMARY KEY,
    group_id    INTEGER NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    from_email  TEXT NOT NULL,  -- email de un miembro o 'invitado:<id>'
    to_email    TEXT NOT NULL,
    importe_enc BYTEA NOT NULL,
    fecha       DATE NOT NULL,
    created_by  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_guests_group ON group_guests(group_id);
CREATE INDEX IF NOT EXISTS idx_group_expenses_group ON group_expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_group_settlements_group ON group_settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON expense_group_members(user_email);

-- Gastos compartidos INTEGRADOS en los movimientos (ver docs-diseno-gastos-compartidos-v2.md).
-- Las tablas expense_group*/group_* de arriba ya no se usan (se conservan sin tocar).
-- Personas = contactos del propio usuario, sin cuenta. Nombres, totales y partes CIFRADOS.
-- Aditivo e idempotente; el backend también lo crea al arrancar (ensure_shared_tables).
CREATE TABLE IF NOT EXISTS shared_people (
    id         SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    nombre_enc BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared_expenses (
    id             SERIAL PRIMARY KEY,
    user_email     TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    transaction_id INTEGER UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    paid_by        TEXT NOT NULL,  -- 'yo' o 'p:<id>'
    total_enc      BYTEA NOT NULL,
    fecha          DATE NOT NULL,
    etiqueta_enc   BYTEA,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared_shares (
    expense_id INTEGER NOT NULL REFERENCES shared_expenses(id) ON DELETE CASCADE,
    party      TEXT NOT NULL,  -- 'yo' o 'p:<id>'
    share_enc  BYTEA NOT NULL,
    PRIMARY KEY (expense_id, party)
);

CREATE TABLE IF NOT EXISTS shared_settlements (
    id          SERIAL PRIMARY KEY,
    user_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    from_party  TEXT NOT NULL,
    to_party    TEXT NOT NULL,
    importe_enc BYTEA NOT NULL,
    fecha       DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_people_user ON shared_people(user_email);
CREATE INDEX IF NOT EXISTS idx_shared_expenses_user ON shared_expenses(user_email);
CREATE INDEX IF NOT EXISTS idx_shared_settlements_user ON shared_settlements(user_email);
-- Gastos fijos que se repiten cada mes hasta una fecha (el piso hasta dic-2027). Se
-- proyectan en la app como gasto fijo previsto; concepto e importe CIFRADOS (AES-GCM).
-- Aditivo e idempotente; el backend también lo crea al arrancar (ensure_fixed_recurring_table).
CREATE TABLE IF NOT EXISTS fixed_recurring (
    id           SERIAL PRIMARY KEY,
    user_email   TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    concepto_enc BYTEA NOT NULL,
    importe_enc  BYTEA NOT NULL,
    dia          INTEGER NOT NULL DEFAULT 1 CHECK (dia BETWEEN 1 AND 31),
    desde        DATE NOT NULL,   -- primer día del mes de inicio
    hasta        DATE,            -- primer día del último mes; NULL = sin fecha de fin
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fixed_recurring_user ON fixed_recurring(user_email);

-- Row Level Security en todas las tablas de public, SIN políticas: bloquea el
-- acceso por la API REST de Supabase (roles anon/authenticated) a estas tablas.
-- El backend se conecta como owner de las tablas, que no está sujeto a RLS
-- (no se usa FORCE ROW LEVEL SECURITY), así que su comportamiento no cambia.
-- Idempotente: activar RLS sobre una tabla que ya la tiene no hace nada.
ALTER TABLE public.users                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goal_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goal_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annual_fixed_expenses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_rules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_prefs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revoked_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_groups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_group_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_guests               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_expenses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_expense_shares       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_settlements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_recurring            ENABLE ROW LEVEL SECURITY;
