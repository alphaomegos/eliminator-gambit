from __future__ import annotations

import os
import time
from contextlib import contextmanager

from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


def init_pool() -> ConnectionPool:
    global _pool
    if _pool is not None:
        return _pool

    url = get_database_url()
    pool = ConnectionPool(conninfo=url, min_size=1, max_size=10, open=False)

    last_err: Exception | None = None
    for _ in range(30):
        try:
            pool.open()
            with pool.connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1;")
                    cur.fetchone()
            _pool = pool
            return pool
        except Exception as e:
            last_err = e
            time.sleep(1)

    raise RuntimeError(f"Database is not ready: {last_err}")  # noqa: TRY003


def pool() -> ConnectionPool:
    if _pool is None:
        return init_pool()
    return _pool


@contextmanager
def db_conn():
    p = pool()
    with p.connection() as conn:
        yield conn

