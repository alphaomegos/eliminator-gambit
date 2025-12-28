from __future__ import annotations

from typing import Any, Mapping, Sequence

Params = Sequence[Any] | Mapping[str, Any] | None


class BaseRepo:
    def __init__(self, cur: Any):
        self.cur = cur

    def execute(self, query: str, params: Params = None) -> None:
        self.cur.execute(query, params)

    def fetchone(self) -> Any:
        return self.cur.fetchone()

    def fetchall(self) -> Any:
        return self.cur.fetchall()
