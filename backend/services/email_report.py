"""Informe mensual por email, vía Resend (REST simple, sin SDK nuevo — reusa httpx).

Dos formas de disparo:
  - send_monthly_report(email, name): el propio usuario se envía su informe
    (endpoint protegido por JWT, botón manual en Ajustes).
  - send_monthly_reports_to_all(): todos los usuarios reciben el suyo (pensado
    para un cron externo — endpoint protegido por CRON_SECRET, no por JWT).

Si RESEND_API_KEY no está configurada, no lanza — devuelve {"sent": False}.
"""
import os
from datetime import date
import httpx

from .sheets import get_finance_data
from .users import get_all_users

RESEND_API_KEY    = os.getenv("RESEND_API_KEY", "")
REPORT_FROM_EMAIL = os.getenv("REPORT_FROM_EMAIL", "onboarding@resend.dev")

MONTH_NAMES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


def _sum_month(items: list[dict], m: int) -> float:
    return sum((i["amounts"][m] or 0) for i in items)


def _month_stats(data: dict, m: int) -> dict:
    income   = _sum_month(data["income"], m)
    fixed    = _sum_month(data["fixedExpenses"], m)
    variable = _sum_month(data["variableExpenses"], m)
    expenses = fixed + variable
    balance  = income - expenses
    return {"income": income, "fixed": fixed, "variable": variable, "expenses": expenses, "balance": balance}


def _fmt(n: float) -> str:
    return f"{n:,.0f} €".replace(",", ".")


def _render_html(name: str, month_idx: int, stats: dict, top_categories: list[dict]) -> str:
    month_name = MONTH_NAMES[month_idx]
    balance_color = "#34C759" if stats["balance"] >= 0 else "#FF3B30"
    rows = "".join(
        f'<tr><td style="padding:6px 0;color:#3C3C43;font-size:14px">{c["emoji"]} {c["concept"]}</td>'
        f'<td style="padding:6px 0;text-align:right;font-weight:700;color:#1D1D1F;font-size:14px">{_fmt(c["total"])}</td></tr>'
        for c in top_categories
    ) or '<tr><td style="padding:6px 0;color:#8E8E93;font-size:13px">Sin gastos registrados este mes.</td></tr>'

    return f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#F5F5F7">
      <h1 style="font-size:20px;color:#1D1D1F;margin:0 0 4px">Hola {name} 👋</h1>
      <p style="color:#6E6E73;font-size:14px;margin:0 0 24px">Tu resumen de {month_name}</p>
      <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:16px">
        <div style="font-size:12px;color:#6E6E73;text-transform:uppercase;letter-spacing:0.06em">Saldo del mes</div>
        <div style="font-size:32px;font-weight:800;color:{balance_color};letter-spacing:-0.02em">{_fmt(stats["balance"])}</div>
        <div style="display:flex;gap:16px;margin-top:12px;font-size:13px;color:#6E6E73">
          <span>Ingresos: <strong style="color:#1D1D1F">{_fmt(stats["income"])}</strong></span>
          <span>Gastos: <strong style="color:#1D1D1F">{_fmt(stats["expenses"])}</strong></span>
        </div>
      </div>
      <div style="background:#fff;border-radius:16px;padding:20px">
        <div style="font-size:12px;color:#6E6E73;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">Top categorías</div>
        <table style="width:100%;border-collapse:collapse">{rows}</table>
      </div>
      <p style="color:#AEAEB2;font-size:11px;text-align:center;margin-top:24px">Mi Economía — control de gastos personal</p>
    </div>
    """


async def send_monthly_report(email: str, name: str) -> dict:
    if not RESEND_API_KEY:
        return {"sent": False, "reason": "RESEND_API_KEY no configurada"}

    data = await get_finance_data(email)
    if not data.get("configured"):
        return {"sent": False, "reason": "sin transacciones registradas"}

    today = date.today()
    month_idx = today.month - 2  # mes anterior, 0-indexado
    if month_idx < 0:
        month_idx = 11

    stats = _month_stats(data, month_idx)

    top = sorted(
        (
            {"concept": i["concept"], "emoji": i["emoji"], "total": sum(i["amounts"])}
            for i in [*data["fixedExpenses"], *data["variableExpenses"]]
        ),
        key=lambda x: x["total"],
        reverse=True,
    )
    top = [t for t in top if t["total"] > 0][:5]

    html = _render_html(name or email.split("@")[0], month_idx, stats, top)

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={
                "from":    REPORT_FROM_EMAIL,
                "to":      [email],
                "subject": f"Tu resumen de {MONTH_NAMES[month_idx]} — Mi Economía",
                "html":    html,
            },
        )

    if res.status_code >= 400:
        return {"sent": False, "reason": f"Resend error {res.status_code}: {res.text[:200]}"}
    return {"sent": True}


async def send_monthly_reports_to_all() -> list[dict]:
    users = await get_all_users()
    results = []
    for u in users:
        r = await send_monthly_report(u["email"], u.get("name", ""))
        results.append({"email": u["email"], **r})
    return results
