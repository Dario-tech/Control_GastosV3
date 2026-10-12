# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Control_GastosV3 ("Mi Economía") is a personal/family expense-tracking app. The repo has two deployed parts:

- `controlGastosMovil/` — the **active** frontend: React 18 + Vite PWA. This is the one you edit for any UI/frontend work.
- `backend/` — FastAPI + Postgres API that the frontend talks to.

## Running everything locally

If the user asks to run the app locally (frontend + backend + database together), **use `LOCAL_SETUP.md`**, not the per-component commands below — it's a self-contained Docker Compose setup (`docker-compose.local.yml`) that gives a working `http://localhost:5173` with a seeded test login, validated end-to-end. The commands below are for working on one component at a time against a database you already have running some other way.

## Commands

### Frontend (`controlGastosMovil/`)
```
npm install
npm run dev       # Vite dev server
npm run build     # production build (also runs vite-plugin-pwa)
npm run preview   # preview a production build
npm test          # unit tests (vitest + jsdom), in controlGastosMovil/tests/
```
Unit tests live in `controlGastosMovil/tests/` (pure logic in `src/utils` and `src/hooks`, plus render/import regression tests for the split modals). No linter is configured. `check.mjs` is a manual Playwright smoke script (375px, selectors `data-tour="tab-..."`); it needs `npm run dev` running and is not part of `npm test`. Verify changes with `npm test` plus `npm run build`.

### Backend (`backend/`)
```
pip install -r requirements.txt
uvicorn main:app --reload
```
Requires these env vars at minimum to run against a real database: `DATABASE_URL` (Postgres), `JWT_SECRET`, `DB_ENCRYPTION_KEY` (32 bytes, base64 — see `services/crypto.py` for how to generate one). `GOOGLE_CLIENT_ID` is only needed to test Google login; email/password login works without it. See `backend/.env.example` and `QA-SETUP.md` for the full list and how to stand up an isolated QA environment (separate Render + Vercel + Supabase instances, driven by the `qa` branch).

There is no test suite for the backend either (no pytest). Verify backend changes by running the API against a local/QA database and hitting endpoints. `schema.sql` is the schema source of truth (idempotent `CREATE TABLE IF NOT EXISTS`); `seed_qa.py` seeds a QA DB and `migrate_encrypt_existing.py` is a one-off migration for pre-encryption rows.

Optional backend env vars (features degrade gracefully when unset): `ANTHROPIC_API_KEY` (emoji suggestion for new categories), `RESEND_API_KEY` / `REPORT_FROM_EMAIL` (monthly email report), `CRON_SECRET` (guards the all-users report endpoint, which is meant to be hit by an external cron), `DB_POOL_MAX`.

## Architecture

### Backend
`main.py` registers every route directly (no router modules/blueprints) and delegates logic to `services/*.py`. Notable points that aren't obvious from file names alone:

- **`services/sheets.py` is the transactions module, not a Google Sheets integration** — the name is historical (the project read/wrote a Google Sheet in an earlier version). Transaction data lives entirely in Postgres today, accessed through `services/db.py`'s connection pool. `APPS_SCRIPT_URL` in `.env.example`/`render.yaml` is a leftover from that era and isn't read anywhere in the current Python code.
- **`concepto` and `importe` are encrypted at rest** (AES-GCM, `services/crypto.py`, key from `DB_ENCRYPTION_KEY`) so a DB leak doesn't expose amounts/categories; `tipo`, `fecha` and `comentario` stay in plaintext. Aggregation (sums, top categories) happens in Python after decrypting, not in SQL.
- **Two independent login paths** into the same JWT session: Google ID token verification (`verify_google_token`) and email+bcrypt (`hash_password`/`verify_password`), both in `services/auth.py`.
- **A third, separate auth path** exists for the iOS Shortcuts integration: `/api/shortcut/pending` takes a permanent per-user `shortcut_token` instead of a JWT, so a Shortcut can log a pending expense without opening the app.
- **Shortcut-pending categorization has no merchant text** (only amount + date), so `services/suggest.py` guesses the category from the user's own history; `services/ai_categorize.py` (Claude) is only used for emoji on manually-created categories.
- **Live updates are SSE, not polling-only**: `/api/events` holds open connections in a module-level `_sse_clients` set; any mutating endpoint calls `_broadcast()`, which pushes to *every* connected client (not scoped per-user), and the frontend refetches `/api/finance` on receipt.

### Frontend
`controlGastosMovil/src/App.jsx` nests four context providers — `AuthProvider` → `SettingsProvider` → `AppProvider` → `FinanceDataProvider` — and most screens read from more than one. Specifics worth knowing before changing data flow:

- `FinanceDataContext` is cache-first: it loads last-known data from `localStorage` synchronously on mount, then refreshes over SSE (see above) with a 5-minute poll as a backup, and re-fetches on tab-visibility change. `status` (`idle`/`loading`/`live`/`offline`) reflects this.
- Domain logic lives in `hooks/` (budgets, savings goals, recurring/subscription detection, annual fixed expenses that can be split across months) and `services/*Api.js` (thin fetch wrappers), kept separate from `components/`.
- `components/` is organized by role: `auth/`, `layout/` (header, bottom nav, profile panel), `tabs/` (the four screens — Year, Month, Stats, Budget/Planning), `charts/` (recharts wrappers), `ui/` (modals and standalone widgets).
- **The Investments tab is present in code but not reachable in the UI** — `App.jsx` only mounts `year`/`month`/`stats`/`budget`, and `BottomNav` has no entry for it. `InvestmentsTab.jsx` itself just renders a placeholder. The supporting components/hooks/services (`InvestmentCard`, `useInvestments`, `investmentApi.js`, etc.) and the `/api/investments/prices` backend endpoint are dead code paths, not a hidden feature — don't assume they're exercised by anything.
- Styling is one file, `src/App.css` (~2900 lines), using CSS custom properties for theming rather than a CSS-in-JS or utility framework. `:root` is the dark theme (default); `html.light` and `html.pastel` override the same variable set for the other two themes. New components should read colors/spacing from these variables, not hardcode values, so all three themes stay in sync.
- The app shell is fixed-width, mobile-only (`max-width: 430px`, see `.app` in `App.css`) — there's no responsive/desktop layout to preserve.
- `vite-plugin-pwa` handles the PWA manifest/service worker (config in `vite.config.js`); there's no native app wrapper (Capacitor etc.) in the codebase yet, though it's been discussed as a possible direction.

## Deployment notes

- Branch `qa` drives the isolated QA environment (see `QA-SETUP.md`); production config is in `render.yaml` (backend) and `vercel.json` (frontend).
- `.github/workflows/keep-alive.yml` pings the production `/api/health` every 10 min because Render's free tier sleeps after 15 min idle — keep `/api/health` cheap and unauthenticated.
- Specialist subagents live in `.claude/agents/` (`frontal`, `backend`, `infra`, `qa`, `seguridad`, `tester`). Typical flow: `qa`/`seguridad` find issues (read-only) → `backend`/`frontal` fix them on a `fix/*` branch → `tester` adds regression tests → `qa` re-verifies. When invoked as subagents they assume **local** mode unless told otherwise. The README is only a one-line stub, so don't rely on it for context.

## Trabajo en paralelo (varias sesiones o agentes)

Varias sesiones de Claude (por ejemplo los agentes `frontal` y `backend` de `.claude/agents/`) pueden trabajar a la vez en la misma carpeta y la misma rama. Para no pisarse:

- **Nunca uses `git add -A` ni `git add .`**: arrastran a tu commit los cambios sin terminar de otra sesión. Añade solo tus ficheros por ruta (`git add backend/main.py`) y comprueba `git status` / `git diff --cached` antes de commitear.
- Cada agente toca solo su zona (`controlGastosMovil/` o `backend/`). Si necesita un cambio en la zona del otro, lo describe en lugar de editarlo.
- Si ves cambios sin commitear que no son tuyos, déjalos como están: no los reviertas ni los incluyas en tu commit.
- Antes de hacer push, haz `git fetch`; si la rama remota avanzó, integra con rebase en vez de forzar el push.
- Para trabajo largo o de riesgo, usa un worktree aparte por sesión.
