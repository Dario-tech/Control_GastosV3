import os
import asyncio
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor

_pool: ThreadedConnectionPool | None = None


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(1, 5, os.getenv("DATABASE_URL"))
    return _pool


def init_pool():
    _get_pool()


class _Conn:
    """Context manager: toma una conexión del pool, hace commit/rollback y la devuelve."""
    def __enter__(self):
        self._conn   = _get_pool().getconn()
        self._cursor = self._conn.cursor(cursor_factory=RealDictCursor)
        return self._cursor

    def __exit__(self, exc_type, *_):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()
        self._cursor.close()
        _get_pool().putconn(self._conn)


def db_cursor() -> _Conn:
    return _Conn()


async def run_in_thread(fn):
    """Ejecuta una función síncrona de DB en un hilo para no bloquear el event loop."""
    return await asyncio.to_thread(fn)
