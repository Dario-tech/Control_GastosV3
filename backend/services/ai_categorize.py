"""Sugerencia de emoji por IA para categorías nuevas.

Los pendientes que llegan del Atajo iOS solo traen importe y fecha, nunca una
descripción de comercio — así que no hay texto que categorizar con IA ahí (ver
suggest.py para la heurística estadística que sí aplica en ese caso).

Donde SÍ hay texto real es cuando el usuario crea una categoría nueva a mano:
escribe un nombre ("Farmacia", "Peluquería"...) y hoy se le asigna el emoji
genérico 💶 por defecto. Aquí usamos Claude para sugerir un emoji acertado
a partir de ese nombre.
"""
import os
from pydantic import BaseModel

from .db import run_in_thread

DEFAULT_EMOJI = "💶"
_MODEL = "claude-opus-4-8"

_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic()
    return _client


class _EmojiSuggestion(BaseModel):
    emoji: str


async def suggest_emoji(nombre: str) -> str:
    """Sugiere un emoji para una categoría nueva. Nunca lanza — ante cualquier
    fallo (sin API key, error de red, etc.) devuelve el emoji por defecto."""
    if not nombre or not os.getenv("ANTHROPIC_API_KEY"):
        return DEFAULT_EMOJI

    def _call():
        client = _get_client()
        response = client.messages.parse(
            model=_MODEL,
            max_tokens=64,
            messages=[{
                "role": "user",
                "content": (
                    "Sugiere UN único emoji que represente mejor esta categoría "
                    f'de gasto o ingreso personal: "{nombre}". '
                    "Responde solo con el emoji."
                ),
            }],
            output_format=_EmojiSuggestion,
        )
        parsed = response.parsed_output
        emoji = (parsed.emoji if parsed else "").strip()
        return emoji or DEFAULT_EMOJI

    try:
        return await run_in_thread(_call)
    except Exception:
        return DEFAULT_EMOJI
