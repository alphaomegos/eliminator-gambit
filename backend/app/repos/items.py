from __future__ import annotations

import uuid
from typing import Any, Optional
from .base import BaseRepo

class ItemRepo(BaseRepo):
    def insert_item(
        self,
        *,
        round_id: uuid.UUID,
        title: str,
        rating: Any,
        secret_text: Optional[str],
        image_data: Optional[str],
    ) -> uuid.UUID:
        self.execute(
            """
            INSERT INTO items (round_id, title, rating, secret_text, image_data, eliminated)
            VALUES (%s, %s, %s, %s, %s, false)
            RETURNING id
            """,
            (round_id, title, rating, secret_text, image_data),
        )
        (item_id,) = self.fetchone()
        return item_id
    def find_min_rating_item_id(self, *, round_id: uuid.UUID) -> uuid.UUID:
        self.execute(
            "SELECT id FROM items WHERE round_id=%s ORDER BY rating ASC NULLS LAST, title ASC LIMIT 1",
            (round_id,),
        )
        row = self.fetchone()
        if not row:
            raise RuntimeError("No items found for round")
        return row[0]
