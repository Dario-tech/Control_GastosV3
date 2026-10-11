import os
import asyncio
import threading
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor

_POOL_MAX = int(os.getenv("DB_POOL_MAX", "5"))
_ACQUIRE_TIMEOUT = 30  # s máx. esperando una conexión libre antes de fallar

_pool: ThreadedConnectionPool | None = None
# psycopg2 lanza PoolError si se piden más conexiones que maxconn en vez de
# esperar. Este semáforo hace que los hilos sobrantes esperen su turno.
_slots = threading.BoundedSemaphore(_POOL_MAX)
_init_lock = threading.Lock()


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _init_lock:  # evita crear dos pools si llegan hilos a la vez
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    1, _POOL_MAX, os.getenv("DATABASE_URL"),
                    connect_timeout=10,
                    keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3,
                )
    return _pool


def init_pool():
    _get_pool()


class _Conn:
    """Context manager: toma una conexión del pool, hace commit/rollback y la devuelve."""
    def __enter__(self):
        if not _slots.acquire(timeout=_ACQUIRE_TIMEOUT):
            raise RuntimeError("Sin conexiones libres en el pool de BD (timeout)")
        self._conn = None
        self._cursor = None
        try:
            self._conn   = _get_pool().getconn()
            self._cursor = self._conn.cursor(cursor_factory=RealDictCursor)
            return self._cursor
        except BaseException:
            self._release(broken=True)
            raise

    def _release(self, broken: bool):
        """Devuelve la conexión al pool (o la descarta si está rota) y libera el hueco."""
        try:
            if self._cursor is not None:
                try:
                    self._cursor.close()
                except Exception:
                    broken = True
            if self._conn is not None:
                if self._conn.closed:
                    broken = True
                _get_pool().putconn(self._conn, close=broken)
        finally:
            self._conn = self._cursor = None
            _slots.release()

    def __exit__(self, exc_type, *_):
        broken = False
        try:
            if exc_type:
                try:
                    self._conn.rollback()
                except Exception:
                    broken = True
            else:
                try:
                    self._conn.commit()
                except Exception:
                    broken = True
                    try:
                        self._conn.rollback()
                    except Exception:
                        pass
                    raise
        finally:
            self._release(broken)


def db_cursor() -> _Conn:
    return _Conn()


async def run_in_thread(fn):
    """Ejecuta una función síncrona de DB en un hilo para no bloquear el event loop."""
    return await asyncio.to_thread(fn)
