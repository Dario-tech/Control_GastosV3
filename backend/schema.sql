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
    comentario   TEXT  -- nota libre opcional, se puede añadir al crear o después (sin cifrar)
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_email);
-- Paginación de la búsqueda por (usuario, fecha, id) sin escanear toda la tabla.
CREATE INDEX IF NOT EXISTS idx_transactions_search ON transactions(user_email, fecha DESC, id DESC);

-- Pagos pendientes de categorizar (llegan del Atajo iOS con importe + fecha,
-- y desde el Atajo de Cartera/Apple Pay también con comercio).
-- comercio_enc: comercio cifrado (AES-GCM); comercio_hmac / id_externo_hmac:
-- HMAC-SHA256 con subclave derivada de DB_ENCRYPTION_KEY (crypto.hmac_tag), para
-- detectar duplicados y buscar reglas por igualdad sin guardar el texto en claro.
-- fuente: 'wallet' | 'atajo' | NULL (creado desde la app o antes de existir la columna).
CREATE TABLE IF NOT EXISTS pending_transactions (
    id              SERIAL PRIMARY KEY,
    user_email      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    importe         NUMERIC(12,2) NOT NULL,
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
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
