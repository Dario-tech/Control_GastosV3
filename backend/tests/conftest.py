"""Entorno de pruebas: sin BD real ni red. Las variables se fijan ANTES de
importar los servicios (auth.py exige JWT_SECRET al importarse)."""
import base64
import os

os.environ["JWT_SECRET"] = "test-secret-only-for-pytest-0123456789"
os.environ["DB_ENCRYPTION_KEY"] = base64.b64encode(os.urandom(32)).decode()
os.environ["DATABASE_URL"] = "postgresql://invalid:invalid@127.0.0.1:1/none"  # nunca se usa
os.environ["CRON_SECRET"] = "test-cron-secret"
for _k in ("ANTHROPIC_API_KEY", "RESEND_API_KEY"):
    os.environ.pop(_k, None)

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    import main
    # Sin "with": no se ejecuta el lifespan (que tocaría la BD).
    return TestClient(main.app)


@pytest.fixture
def auth_headers():
    from services.auth import create_jwt
    return {"Authorization": f"Bearer {create_jwt('test@example.com')}"}
