# Entorno de QA — guía de montaje

Entorno de pruebas **aislado de producción** para probar cambios antes de
pasarlos a `main`, sin tocar los datos ni la infraestructura reales.

La rama de integración de QA es **`qa`** — es **permanente**, no se borra. Las
ramas de feature se mergean a `qa` para probarlas y luego a `main`:

```
feature/*  ──merge──►  qa  ──merge──►  main
                        │                │
                     Render+Vercel QA   producción
```

Arquitectura de QA (espejo de producción, pero separado):

```
Vercel (rama qa)  ──►  Render (backend QA, rama qa)  ──►  Supabase (BD QA)
   VITE_API_URL=backend QA                                schema.sql + seed_qa.sql
```

**Credenciales de test** (creadas por `seed_qa.sql`):
- Email: `qa@mieconomia.test`
- Contraseña: `QaTest1234!`

---

## 1. Base de datos QA (Supabase)

1. En [supabase.com](https://supabase.com) → **New project** (nómbralo `control-gastos-qa`). Guarda la contraseña de la BD que te pida.
2. Cuando esté listo: **Project Settings → Database → Connection string**, elige la pestaña del **Session pooler** (no la conexión directa: los proyectos nuevos de Supabase solo exponen esa por IPv6, y Render no tiene salida IPv6). Formato `postgresql://postgres.XXXXX:...@aws-0-<región>.pooler.supabase.com:5432/postgres`. Será el `DATABASE_URL` del backend QA.
3. Ve a **SQL Editor** y ejecuta el contenido de `backend/schema.sql` → crea las tablas.
4. Genera la clave de cifrado (`DB_ENCRYPTION_KEY`, ver services/crypto.py — concepto e importe de las transacciones se guardan cifrados):
   ```bash
   python -c "import os, base64; print(base64.b64encode(os.urandom(32)).decode())"
   ```
5. Aplica el usuario de test y los datos de muestra con el script (ya no es SQL puro, porque cifra al insertar):
   ```bash
   cd backend
   DATABASE_URL="..." DB_ENCRYPTION_KEY="..." python seed_qa.py
   ```

> Con esto la BD de QA queda lista y con datos. Producción no se toca en ningún momento.

---

## 2. Backend QA (Render)

1. En [render.com](https://render.com) → **New → Web Service** → conecta el repo `Control_GastosV3`.
2. Configuración:
   - **Branch**: `qa`  ← rama permanente de QA (no la de feature)
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Name**: `control-gastos-api-qa`
3. **Environment Variables** (Advanced → Add Environment Variable):

   | Clave | Valor |
   |-------|-------|
   | `DATABASE_URL` | *(la URI del pooler de Supabase QA del paso 1.2)* |
   | `JWT_SECRET` | *(genera uno propio — ver abajo. NO se commitea al repo)* |
   | `DB_ENCRYPTION_KEY` | *(la clave del paso 1.4 — misma que usaste al ejecutar seed_qa.py)* |
   | `CORS_ORIGINS` | *(la URL del frontend QA — la rellenas tras el paso 3; de momento pon `*` temporalmente)* |

   Genera el `JWT_SECRET` con:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
   | `GOOGLE_CLIENT_ID` | *(opcional; solo si quieres probar también Google. Para email no hace falta)* |

4. **Create Web Service**. Al arrancar, la migración aditiva (`password_hash`) corre sola. Copia la URL que te da Render (algo como `https://control-gastos-api-qa.onrender.com`).
5. Verifica que vive: abre `https://control-gastos-api-qa.onrender.com/api/health` → debe responder `{"status":"ok"}`.

> ⚠️ El `JWT_SECRET` de arriba es **exclusivo de QA**. Producción debe tener el suyo propio y distinto (esto conecta con el hallazgo C1 de la auditoría).

---

## 3. Frontend QA (Vercel)

Objetivo: que el preview de la rama apunte al backend QA, no al de producción.

**Opción recomendada — proyecto Vercel separado (aislamiento total):**
1. [vercel.com](https://vercel.com) → **Add New → Project** → importa el mismo repo.
2. **Root Directory**: raíz (usa el `vercel.json` existente).
3. **Production Branch**: `feature/mejoras-fase2` (Settings → Git).
4. **Environment Variables**:

   | Clave | Valor |
   |-------|-------|
   | `VITE_API_URL` | `https://control-gastos-api-qa.onrender.com` *(la URL del paso 2.4)* |
   | `VITE_GOOGLE_CLIENT_ID` | *(opcional, solo para Google)* |

5. **Deploy**. Copia la URL que te da Vercel (p. ej. `https://control-gastos-qa.vercel.app`).
6. **Vuelve a Render** (paso 2.3) y pon esa URL en `CORS_ORIGINS` (sustituye el `*` temporal). Guarda → Render redespliega.

---

## 4. Entrar

1. Abre la URL del frontend QA.
2. Pantalla de login → **no** uses Google → rellena:
   - Email: `qa@mieconomia.test`
   - Contraseña: `QaTest1234!`
3. Deberías entrar y ver los datos de muestra. Comprueba:
   - **Mes (julio)** → tarjeta *"Resumen del mes"* comparando con junio.
   - **Stats** → *"Suscripciones detectadas: Netflix"*.
   - **Budget** → *"Metas de ahorro"* (crea una).
   - **Lupa (cabecera)** → busca "netflix".
   - **Campana** → categorizar el pago pendiente, con botón *"✨ Sugerido → Comida"*.

O crea tu propia cuenta con **"Crear cuenta"** para probar el registro de cero.

---

## Notas

- **Nada de esto toca producción**: BD, backend y frontend son recursos nuevos y separados.
- Para **tirar** el entorno QA: borra el proyecto de Render, el de Vercel y el de Supabase. Sin residuos.
- El **plan gratis** de Render duerme el servicio tras inactividad: la primera petición tras un rato tarda ~30 s en despertar. Normal en QA.
- Flujo para futuros cambios: mergea tu `feature/*` a **`qa`** → Render y Vercel redespliegan solos y pruebas ahí → cuando esté validado, mergea `qa` a **`main`** (producción, con su propio `JWT_SECRET` ya verificado).
- La rama `qa` **no se borra**. Las ramas de feature sí se pueden borrar tras mergearlas.

---

## Desarrollo local contra la BD de QA

> ⚠️ Este flujo escribe en la **BD de QA compartida**. Para probar sin riesgo con datos de usar y tirar, usa el entorno Docker de [`LOCAL_SETUP.md`](LOCAL_SETUP.md) (recomendado por defecto).

Base de datos QA (Supabase): host `db.qmqseibceutmczfggelx.supabase.co`, puerto `5432`.

1. `cp backend/.env.example backend/.env` y rellena `DATABASE_URL`
   (`postgresql://postgres:[YOUR-PASSWORD]@db.qmqseibceutmczfggelx.supabase.co:5432/postgres`)
   `DB_ENCRYPTION_KEY` (la original de QA, la de Render) y `JWT_SECRET`. El backend carga `backend/.env` solo. Los ficheros `.env` están en `.gitignore`: la contraseña nunca va al repo ni a los `.md`.
2. Si tu red no tiene IPv6 y la conexión directa falla, usa la URI del **Session pooler** (ver paso 1.2).
3. Backend: `cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --port 8000`
4. Frontend: `cd controlGastosMovil && echo "VITE_API_URL=http://127.0.0.1:8000" > .env.local && npm run dev`
