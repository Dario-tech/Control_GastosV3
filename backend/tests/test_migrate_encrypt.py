"""migrate_encrypt_existing.py: si la verificación falla, solo se imprime el id
de la fila, nunca concepto ni importe (MIGRACION_QA_A_PROD.md §3.2 punto 2)."""
import os

import pytest

import migrate_encrypt_existing as mig
from services import crypto

SECRETO = "ConceptoSecretoMigracion"
IMPORTE_RARO = 987.65


class FakeCur:
    def __init__(self, rows):
        self.rows = rows
        self._res = []

    def execute(self, sql, params=None):
        q = " ".join(sql.split())
        if q.startswith("SELECT id, concepto, importe FROM transactions WHERE concepto_enc IS NULL"):
            self._res = [dict(r) for r in self.rows if r["concepto_enc"] is None]
        elif q.startswith("UPDATE transactions SET concepto_enc"):
            cenc, ienc, rid = params
            for r in self.rows:
                if r["id"] == rid:
                    r["concepto_enc"], r["importe_enc"] = cenc, ienc
        elif q.startswith("SELECT id, concepto, importe, concepto_enc, importe_enc FROM transactions"):
            self._res = [dict(r) for r in self.rows]
        elif q.startswith("ALTER TABLE"):
            pass
        else:
            raise AssertionError(q)

    def fetchall(self):
        return self._res

    def close(self):
        pass


class FakeConn:
    def __init__(self, rows):
        self.cur = FakeCur(rows)
        self.autocommit = True

    def cursor(self):
        return self.cur

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


def _run(monkeypatch, rows):
    monkeypatch.setattr(mig.psycopg2, "connect", lambda *a, **k: FakeConn(rows))
    mig.main()


def _otra_clave(texto: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)
    return nonce + AESGCM(os.urandom(32)).encrypt(nonce, texto, None)


def test_verificacion_ok(monkeypatch, capsys):
    rows = [{"id": 1, "concepto": SECRETO, "importe": IMPORTE_RARO, "concepto_enc": None, "importe_enc": None}]
    _run(monkeypatch, rows)
    out = capsys.readouterr().out
    assert "Verificación OK" in out
    assert SECRETO not in out and str(IMPORTE_RARO) not in out


def test_fallo_solo_imprime_ids(monkeypatch, capsys):
    rows = [
        {"id": 1, "concepto": SECRETO, "importe": IMPORTE_RARO, "concepto_enc": None, "importe_enc": None},
        # Cifrado con valores distintos a los en claro.
        {"id": 2, "concepto": SECRETO, "importe": IMPORTE_RARO,
         "concepto_enc": crypto.encrypt_str("OtroConceptoSecreto"), "importe_enc": crypto.encrypt_float(111.11)},
        # Cifrado con otra clave: no se puede descifrar.
        {"id": 3, "concepto": SECRETO, "importe": IMPORTE_RARO,
         "concepto_enc": _otra_clave(SECRETO.encode()), "importe_enc": _otra_clave(b"987.65")},
    ]
    with pytest.raises(SystemExit) as e:
        _run(monkeypatch, rows)
    assert e.value.code == 1
    out = capsys.readouterr().out
    assert "id=2" in out and "id=3" in out and "id=1:" not in out
    for secreto in (SECRETO, "OtroConceptoSecreto", str(IMPORTE_RARO), "111.11"):
        assert secreto not in out
