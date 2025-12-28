from __future__ import annotations

import uuid
from typing import Optional, Any

from .base import BaseRepo

STATUS_ACTIVE = "active"
STATUS_FINISHED = "finished"

class RoundRepo(BaseRepo):
    def get_round_state(self, *, round_id: uuid.UUID, game_set: str) -> Any:
        self.execute(
            """
            SELECT id, kind, status, current_team, target_item_id
            FROM rounds
            WHERE id=%s AND game_set=%s
            """,
            (round_id, game_set),
        )
        return self.fetchone()

    def get_round_details(self, *, round_id: uuid.UUID, game_set: str) -> Any:
        self.execute(
            """
            SELECT id, category, prompt, kind, current_team, status, target_item_id, winner_team, loser_team, image_data
            FROM rounds
            WHERE id=%s AND game_set=%s
            """,
            (round_id, game_set),
        )
        return self.fetchone()

    def list_round_items(self, *, round_id: uuid.UUID) -> Any:
        self.execute(
            """
            SELECT id, title, eliminated, rating, secret_text, eliminated_by_team, image_data
            FROM items
            WHERE round_id=%s
            ORDER BY title ASC
            """,
            (round_id,),
        )
        return self.fetchall()

    def get_item_eliminated_flag(self, *, item_id: uuid.UUID, round_id: uuid.UUID) -> Any:
        self.execute(
            """
            SELECT eliminated
            FROM items
            WHERE id=%s AND round_id=%s
            """,
            (item_id, round_id),
        )
        return self.fetchone()

    def eliminate_item(self, *, item_id: uuid.UUID, round_id: uuid.UUID, team: int) -> None:
        self.execute(
            """
            UPDATE items
            SET eliminated=true, eliminated_by_team=%s
            WHERE id=%s AND round_id=%s
            """,
            (team, item_id, round_id),
        )

    def finish_round(
        self,
        *,
        round_id: uuid.UUID,
        game_set: str,
        winner_team: Optional[int],
        loser_team: Optional[int],
    ) -> None:
        self.execute(
            """
            UPDATE rounds
            SET status=%s, winner_team=%s, loser_team=%s
            WHERE id=%s AND game_set=%s
            """,
            (STATUS_FINISHED, winner_team, loser_team, round_id, game_set),
        )

    def count_remaining_items(self, *, round_id: uuid.UUID) -> int:
        self.execute(
            """
            SELECT COUNT(*)
            FROM items
            WHERE round_id=%s AND eliminated=false
            """,
            (round_id,),
        )
        row = self.fetchone()
        return int(row[0]) if row else 0

    def get_last_remaining_item_id(self, *, round_id: uuid.UUID) -> Optional[uuid.UUID]:
        self.execute(
            "SELECT id FROM items WHERE round_id=%s AND eliminated=false",
            (round_id,),
        )
        row = self.fetchone()
        return row[0] if row else None

    def set_current_team(self, *, round_id: uuid.UUID, game_set: str, team: int) -> None:
        self.execute(
            "UPDATE rounds SET current_team=%s WHERE id=%s AND game_set=%s",
            (team, round_id, game_set),
        )

    def get_placeholder_target_item_id(self) -> uuid.UUID:
        self.execute("SELECT id FROM items LIMIT 1")
        row = self.fetchone()
        return row[0] if row else uuid.UUID(int=0)

    def create_round(
        self,
        *,
        game_set: str,
        category: str,
        prompt: str,
        kind: str,
        current_team: int,
        status: str,
        image_data: Optional[str],
    ) -> uuid.UUID:
        placeholder_target_id = self.get_placeholder_target_item_id()
        self.execute(
            """
            INSERT INTO rounds (game_set, category, prompt, kind, current_team, status, image_data, target_item_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (game_set, category, prompt, kind, int(current_team), status, image_data, placeholder_target_id),
        )
        (round_id,) = self.fetchone()
        return round_id

    def set_target_item_id(self, *, round_id: uuid.UUID, game_set: str, target_item_id: uuid.UUID) -> None:
        self.execute(
            "UPDATE rounds SET target_item_id=%s WHERE id=%s AND game_set=%s",
            (target_item_id, round_id, game_set),
        )
