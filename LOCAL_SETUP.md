# Arranque en local

Guía para levantar los tres componentes (base de datos, backend, frontend) en
la máquina de quien esté trabajando en el repo — aislado, sin tocar QA ni
producción. Validada de extremo a extremo: esquema aplicado, login real,
datos cifrados descifrándose correctamente.

Requisito único: **Docker** (con Docker Compose v2, incluido en instalaciones
recientes de Docker Desktop/Engine).

## Arrancar

Desde la raíz del repo:

```
docker compose -f docker-compose.local.yml up
```

La primera vez (o para resetear los datos de ejemplo), en otra terminal:

```
docker compose -f docker-compose.local.yml exec backend python seed_qa.py
```

## URLs

| Servicio | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend  | http://localhost:8000 |
| Comprobar que el backend vive | http://localhost:8000/api/health |

**Login de prueba** (creado por `seed_qa.py`): `qa@mieconomia.test` / `QaTest1234!`

## Qué hace cada servicio

- **`db`** — Postgres 16. Al crear el volumen por primera vez aplica
  automáticamente `backend/schema.sql` (monta como script de inicialización
  de la imagen oficial de Postgres).
- **`backend`** — instala `backend/requirements.txt` y arranca
  `uvicorn main:app --reload` contra esa base de datos. Usa un
  `JWT_SECRET` y `DB_ENCRYPTION_KEY` fijos, solo válidos en este entorno
  local (no son los de QA ni producción — ver cabecera de
  `docker-compose.local.yml`).
- **`frontend`** — `npm install` + `npm run dev`, con `VITE_API_URL`
  apuntando al backend de arriba.

Los tres montan el código del repo como volumen, así que los cambios que
hagas se reflejan con hot-reload sin reconstruir nada.

## Parar / limpiar

```
docker compose -f docker-compose.local.yml down          # para los contenedores
docker compose -f docker-compose.local.yml down -v        # además borra los datos de la BD local
```

## Notas

- Esto es un entorno **local y aislado** — no comparte base de datos ni
  variables con QA (ver `QA-SETUP.md`) ni con producción. Las claves de
  `docker-compose.local.yml` están pensadas para esto y no pasa nada por
  tenerlas en el repo.
- Si cambias `backend/schema.sql` después de la primera vez, Postgres no lo
  reaplica solo (el script de init solo corre con el volumen vacío). Para
  forzarlo: `docker compose -f docker-compose.local.yml down -v` y volver a
  arrancar.
