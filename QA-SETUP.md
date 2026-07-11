# Entorno de QA — guía de montaje

Entorno de pruebas **aislado de producción** para probar la rama
`feature/mejoras-fase2` (login por email + las 5 mejoras) sin tocar los datos ni
la infraestructura reales.

Arquitectura de QA (espejo de producción, pero separado):

```
Vercel (preview de la rama)  ──►  Render (backend QA)  ──►  Supabase (BD QA)
   VITE_API_URL=backend QA        rama feature/mejoras-fase2     schema.sql + seed_qa.sql
```

**Credenciales de test** (creadas por `seed_qa.sql`):
- Email: `qa@mieconomia.test`
- Contraseña: `QaTest1234!`

---

## 1. Base de datos QA (Supabase)

1. En [supabase.com](https://supabase.com) → **New project** (nómbralo `control-gastos-qa`). Guarda la contraseña de la BD que te pida.
2. Cuando esté listo: **Project Settings → Database → Connection string → URI**. Cópiala (formato `postgresql://postgres:...@...supabase.co:5432/postgres`). Será el `DATABASE_URL` del backend QA.
3. Ve a **SQL Editor** y ejecuta, en este orden:
   - El contenido de `backend/schema.sql` → crea las tablas.
   - El contenido de `backend/seed_qa.sql` → crea el usuario de test y datos de muestra.

> Con esto la BD de QA queda lista y con datos. Producción no se toca en ningún momento.

---

## 2. Backend QA (Render)

1. En [render.com](https://render.com) → **New → Web Service** → conecta el repo `Control_GastosV3`.
2. Configuración:
   - **Branch**: `feature/mejoras-fase2`  ← clave, la rama de QA
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Name**: `control-gastos-api-qa`
3. **Environment Variables** (Advanced → Add Environment Variable):

   | Clave | Valor |
   |-------|-------|
   | `DATABASE_URL` | *(la URI de Supabase QA del paso 1.2)* |
   | `JWT_SECRET` | *(genera uno propio — ver abajo. NO se commitea al repo)* |
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
- Cuando validemos todo en QA, el paso a producción sería un merge de la rama a `main` (con su propio `JWT_SECRET` ya verificado).
