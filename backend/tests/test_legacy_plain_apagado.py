"""Interruptor LEGACY_PLAIN_WRITE: apaga la doble escritura (B2) sin borrar las
columnas en claro, solo si ambas admiten NULL o tienen DEFAULT."""
import pytest

from services import legacy_plain


class _Cur:
    def __init__(self, info):
        self.info = info
        self._res = []

    def execute(self, sql, params=None):
        if sql.startswith("SELECT column_name, is_nullable"):
            self._res = self.info
        else:
            self._res = [{"column_name": r["column_name"]} for r in self.info]

    def fetchall(self):
        return self._res


def _install(monkeypatch, info, flag):
    class _Ctx:
        def __enter__(self):
            return _Cur(info)

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(legacy_plain, "db_cursor", lambda: _Ctx())
    monkeypatch.setattr(legacy_plain, "_enabled", False)
    if flag is None:
        monkeypatch.delenv("LEGACY_PLAIN_WRITE", raising=False)
    else:
        monkeypatch.setenv("LEGACY_PLAIN_WRITE", flag)


def _cols(nullable="NO", default=None):
    return [{"column_name": c, "is_nullable": nullable, "column_default": default}
            for c in ("concepto", "importe")]


def test_sin_variable_sigue_la_doble_escritura(monkeypatch):
    _install(monkeypatch, _cols("NO"), None)
    assert legacy_plain.detect_plain_columns() is True


def test_apagado_con_columnas_nullables(monkeypatch):
    _install(monkeypatch, _cols("YES"), "0")
    assert legacy_plain.detect_plain_columns() is False
    assert legacy_plain.enabled() is False


@pytest.mark.parametrize("valor", ["0", "false", "FALSE", "no", "off", " 0 "])
def test_valores_que_apagan(monkeypatch, valor):
    _install(monkeypatch, _cols("YES"), valor)
    assert legacy_plain.detect_plain_columns() is False


def test_apagado_con_default(monkeypatch):
    _install(monkeypatch, _cols("NO", default="0"), "0")
    assert legacy_plain.detect_plain_columns() is False


def test_se_ignora_si_siguen_not_null(monkeypatch):
    """Sin ALTER previo cada INSERT fallaría: se mantiene la doble escritura."""
    _install(monkeypatch, _cols("NO"), "0")
    assert legacy_plain.detect_plain_columns() is True
    assert legacy_plain.enabled() is True


def test_se_ignora_si_solo_una_es_nullable(monkeypatch):
    info = _cols("NO")
    info[0]["is_nullable"] = "YES"
    _install(monkeypatch, info, "0")
    assert legacy_plain.detect_plain_columns() is True


def test_variable_con_otro_valor_no_apaga(monkeypatch):
    _install(monkeypatch, _cols("YES"), "1")
    assert legacy_plain.detect_plain_columns() is True
