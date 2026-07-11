-- ─────────────────────────────────────────────────────────────────────────────
-- Semilla de QA — usuario de test + datos de muestra.
-- Ejecutar DESPUÉS de schema.sql, sobre la base de datos de QA (NUNCA producción).
-- Re-ejecutable: limpia los datos del usuario de test antes de insertar.
--
--   Login de test →  email:      qa@mieconomia.test
--                    contraseña: QaTest1234!
-- ─────────────────────────────────────────────────────────────────────────────

-- Usuario de test. El hash es bcrypt (cost 12) de "QaTest1234!".
INSERT INTO users (email, name, shortcut_token, password_hash) VALUES
  ('qa@mieconomia.test', 'QA Tester',
   'BlsAlWmj1igk6ICuLA9qncvOThYGyARiRj_6v9Fb_qQ',
   '$2b$12$ZOxOt1mTOEQkgdM0M4280./030CE2uomJR2Lr57Sd881gekEmltya')
ON CONFLICT (email) DO UPDATE
  SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash;

-- Reinicio idempotente de los datos del usuario de test
DELETE FROM transactions        WHERE user_email = 'qa@mieconomia.test';
DELETE FROM pending_transactions WHERE user_email = 'qa@mieconomia.test';

-- Transacciones de mayo, junio y julio 2026.
-- Netflix x3 mensual → dispara "Suscripciones detectadas" (#2).
-- Comida repetida ~34 € → alimenta la sugerencia del pendiente (#1).
-- Julio sube el gasto vs junio → alimenta el "Resumen del mes" (#3).
INSERT INTO transactions (user_email, fecha, tipo, concepto, importe) VALUES
  ('qa@mieconomia.test','2026-05-01','Ingreso','Nómina',3200.00),
  ('qa@mieconomia.test','2026-05-01','Gasto Fijo','Piso',800.00),
  ('qa@mieconomia.test','2026-05-03','Gasto Fijo','Netflix',12.99),
  ('qa@mieconomia.test','2026-05-06','Gasto Variable','Comida',32.40),
  ('qa@mieconomia.test','2026-05-12','Gasto Variable','Comida',28.90),
  ('qa@mieconomia.test','2026-05-18','Gasto Variable','Ocio',45.00),

  ('qa@mieconomia.test','2026-06-01','Ingreso','Nómina',3200.00),
  ('qa@mieconomia.test','2026-06-01','Gasto Fijo','Piso',800.00),
  ('qa@mieconomia.test','2026-06-03','Gasto Fijo','Netflix',12.99),
  ('qa@mieconomia.test','2026-06-07','Gasto Variable','Comida',35.10),
  ('qa@mieconomia.test','2026-06-15','Gasto Variable','Comida',31.20),
  ('qa@mieconomia.test','2026-06-20','Gasto Variable','Ocio',38.00),

  ('qa@mieconomia.test','2026-07-01','Ingreso','Nómina',3200.00),
  ('qa@mieconomia.test','2026-07-01','Gasto Fijo','Piso',800.00),
  ('qa@mieconomia.test','2026-07-03','Gasto Fijo','Netflix',12.99),
  ('qa@mieconomia.test','2026-07-05','Gasto Variable','Comida',34.50),
  ('qa@mieconomia.test','2026-07-08','Gasto Variable','Ocio',60.00),
  ('qa@mieconomia.test','2026-07-09','Gasto Variable','Ropa',75.00);

-- Pago pendiente de categorizar (≈34,50 €) → la app sugerirá "Comida" (#1).
INSERT INTO pending_transactions (user_email, importe, fecha) VALUES
  ('qa@mieconomia.test', 34.50, '2026-07-10');
