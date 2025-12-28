from __future__ import annotations
from typing import Callable, TypeVar
from .db import db_conn

T = TypeVar("T")

def run_in_db(fn: Callable[[object], T]) -> T:
    with db_conn() as conn:
        with conn.cursor() as cur:
            return fn(cur)

def run_in_tx(fn: Callable[[object], T]) -> T:
    with db_conn() as conn:
        try:
            with conn.cursor() as cur:
                result = fn(cur)
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
