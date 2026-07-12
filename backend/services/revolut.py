"""Conexión con Revolut vía GoCardless Bank Account Data (Open Banking / PSD2).

No hablamos con Revolut directamente: GoCardless agrega el acceso a bancos
europeos bajo la normativa de banca abierta. El usuario autoriza el acceso
en la propia web de Revolut — nunca vemos su contraseña.

Flujo:
  1. connect()   -> crea una "requisition" y devuelve el link de autorización.
  2. El usuario autoriza en Revolut y vuelve a nuestra app.
  3. confirm()   -> confirma la requisition y guarda las cuentas asociadas.
  4. sync()      -> descarga movimientos y los inserta en `transactions`
                    (deduplicados por external_id).

Requiere las variables de entorno GOCARDLESS_SECRET_ID y GOCARDLESS_SECRET_KEY
(cuenta gratuita en https://bankaccountdata.gocardless.com/).
"""
import os
import time
import httpx
from fastapi import HTTPException
from .db import db_cursor, run_in_thread

BASE = "https://bankaccountdata.gocardless.com/api/v2"

_token: str | None = None
_token_expires_at: float = 0.0


class RevolutNotConfigured(RuntimeError):
    pass


def _credentials() -> tuple[str, str]:
    sid = os.getenv("GOCARDLESS_SECRET_ID", "")
    key = os.getenv("GOCARDLESS_SECRET_KEY", "")
    if not sid or not key:
        raise RevolutNotConfigured(
            "GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY no configuradas. "
            "Crea una cuenta gratuita en https://bankaccountdata.gocardless.com/ "
            "y añade las credenciales como variables de entorno."
        )
    return sid, key


async def _get_token() -> str:
    global _token, _token_expires_at
    if _token and time.time() < _token_expires_at - 60:
        return _token

    sid, key = _credentials()
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(f"{BASE}/token/new/", json={"secret_id": sid, "secret_key": key})
        res.raise_for_status()
        data = res.json()

    _token = data["access"]
    _token_expires_at = time.time() + data.get("access_expires", 3600)
    return _token


async def _request(method: str, path: str, **kwargs) -> dict:
    token = await _get_token()
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.request(
            method, f"{BASE}{path}", headers={"Authorization": f"Bearer {token}"}, **kwargs
        )
        if res.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Error de GoCardless: {res.status_code} {res.text[:200]}")
        return res.json()


def ensure_bank_connections_table():
    """Migración aditiva e idempotente."""
    with db_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS bank_connections (
                id             SERIAL PRIMARY KEY,
                user_email     TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                provider       TEXT NOT NULL DEFAULT 'revolut',
                requisition_id TEXT NOT NULL,
                account_ids    TEXT[] NOT NULL DEFAULT '{}',
                status         TEXT NOT NULL DEFAULT 'pending',
                last_synced_at TIMESTAMPTZ,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_bank_conn_user ON bank_connections(user_email)")
        # Dedup de movimientos importados: mismo usuario + mismo id externo del banco.
        cur.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_id TEXT")
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_external_unique
            ON transactions(user_email, external_id) WHERE external_id IS NOT NULL
        """)


async def get_connection(email: str) -> dict | None:
    def _q():
        with db_cursor() as cur:
            cur.execute(
                """SELECT id, requisition_id, account_ids, status, last_synced_at::text
                   FROM bank_connections WHERE user_email = %s AND provider = 'revolut'
                   ORDER BY created_at DESC LIMIT 1""",
                (email,),
            )
            return cur.fetchone()
    row = await run_in_thread(_q)
    return dict(row) if row else None


async def _find_revolut_institution() -> str:
    """Busca el id de Revolut entre las instituciones disponibles para España."""
    institutions = await _request("GET", "/institutions/", params={"country": "es"})
    for inst in institutions:
        if "revolut" in inst.get("name", "").lower():
            return inst["id"]
    raise HTTPException(status_code=502, detail="Revolut no aparece disponible en GoCardless ahora mismo")


async def connect(email: str, redirect_url: str) -> dict:
    institution_id = await _find_revolut_institution()
    body = {
        "redirect": redirect_url,
        "institution_id": institution_id,
        "reference": f"{email}-{int(time.time())}",
        "user_language": "ES",
    }
    req = await _request("POST", "/requisitions/", json=body)

    def _q():
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO bank_connections (user_email, provider, requisition_id, status)
                   VALUES (%s, 'revolut', %s, 'pending')""",
                (email, req["id"]),
            )
    await run_in_thread(_q)
    return {"link": req["link"]}


async def confirm(email: str) -> dict:
    """Tras volver de Revolut: confirma la requisition más reciente y guarda las cuentas."""
    conn = await get_connection(email)
    if not conn:
        raise HTTPException(status_code=404, detail="No hay ninguna conexión con Revolut en curso")

    req = await _request("GET", f"/requisitions/{conn['requisition_id']}/")
    accounts = req.get("accounts", [])
    status = "connected" if accounts else req.get("status", "pending")

    def _q():
        with db_cursor() as cur:
            cur.execute(
                "UPDATE bank_connections SET account_ids = %s, status = %s WHERE id = %s",
                (accounts, status, conn["id"]),
            )
    await run_in_thread(_q)
    return {"status": status, "accounts": len(accounts)}


async def disconnect(email: str) -> None:
    def _q():
        with db_cursor() as cur:
            cur.execute("DELETE FROM bank_connections WHERE user_email = %s AND provider = 'revolut'", (email,))
    await run_in_thread(_q)


def _map_transaction(raw: dict) -> dict | None:
    ext_id = raw.get("transactionId") or raw.get("internalTransactionId")
    amount_info = raw.get("transactionAmount", {})
    try:
        amount = float(amount_info.get("amount", 0))
    except (TypeError, ValueError):
        return None
    if not ext_id or amount == 0:
        return None
    fecha = raw.get("bookingDate") or raw.get("valueDate")
    concepto = (
        raw.get("remittanceInformationUnstructured")
        or raw.get("creditorName") or raw.get("debtorName") or "Movimiento Revolut"
    )
    return {
        "external_id": ext_id,
        "fecha": fecha,
        "concepto": concepto.strip()[:200],
        "importe": abs(amount),
        "tipo": "Ingreso" if amount > 0 else "Gasto Variable",
    }


async def sync(email: str) -> dict:
    conn = await get_connection(email)
    if not conn or conn["status"] != "connected":
        raise HTTPException(status_code=400, detail="Conecta primero tu cuenta de Revolut")

    imported = 0
    for account_id in conn["account_ids"]:
        data = await _request("GET", f"/accounts/{account_id}/transactions/")
        booked = data.get("transactions", {}).get("booked", [])
        rows = [r for r in (_map_transaction(t) for t in booked) if r]

        def _q(rows=rows):
            with db_cursor() as cur:
                n = 0
                for r in rows:
                    cur.execute(
                        """INSERT INTO transactions (user_email, tipo, concepto, importe, fecha, external_id)
                           VALUES (%s, %s, %s, %s, %s::date, %s)
                           ON CONFLICT (user_email, external_id) WHERE external_id IS NOT NULL DO NOTHING""",
                        (email, r["tipo"], r["concepto"], r["importe"], r["fecha"], r["external_id"]),
                    )
                    n += cur.rowcount
                return n
        imported += await run_in_thread(_q)

    def _touch():
        with db_cursor() as cur:
            cur.execute("UPDATE bank_connections SET last_synced_at = now() WHERE id = %s", (conn["id"],))
    await run_in_thread(_touch)

    return {"imported": imported}
