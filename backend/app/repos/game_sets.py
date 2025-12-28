from __future__ import annotations
from .base import BaseRepo

class GameSetRepo(BaseRepo):
    def exists(self, *, name: str) -> bool:
        self.execute("SELECT 1 FROM game_sets WHERE name=%s", (name,))
        return self.fetchone() is not None
    def create(self, *, name: str) -> None:
        self.execute(
            "INSERT INTO game_sets(name) VALUES (%s) ON CONFLICT DO NOTHING",
            (name,),
        )
