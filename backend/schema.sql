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

-- Transacciones confirmadas.
CREATE TABLE IF NOT EXISTS transactions (
    id         SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    fecha      DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo       TEXT NOT NULL DEFAULT '',
    concepto   TEXT NOT NULL DEFAULT '',
    importe    NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_email);

-- Pagos pendientes de categorizar (llegan del Atajo iOS con importe + fecha).
CREATE TABLE IF NOT EXISTS pending_transactions (
    id         SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    importe    NUMERIC(12,2) NOT NULL,
    fecha      DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_transactions(user_email);
