from __future__ import annotations

import uuid
from typing import Any, Iterable, List, Optional, Tuple

from .base import BaseRepo
from ..schemas import TemplateItemIn

TemplateSummaryRow = Tuple[uuid.UUID, str, str, str, int]
TemplateRow = Tuple[uuid.UUID, str, str, str, Optional[str]]
TemplateItemRow = Tuple[str, Any, Optional[str], bool, Optional[str]]

class TemplateRepo(BaseRepo):
    def list_summaries(self, *, game_set: str) -> List[TemplateSummaryRow]:
        self.execute(
            """
            SELECT t.id, t.name, t.prompt, t.kind, COUNT(i.id) AS item_count
            FROM templates t
            LEFT JOIN template_items i ON i.template_id = t.id
            WHERE t.game_set = %s
            GROUP BY t.id, t.name, t.prompt, t.kind
            ORDER BY t.updated_at DESC, t.created_at DESC
            """,
            (game_set,),
        )
        return list(self.fetchall() or [])
    def get_template(self, *, template_id: uuid.UUID, game_set: str) -> Optional[TemplateRow]:
        self.execute(
            "SELECT id, name, prompt, kind, image_data FROM templates WHERE id=%s AND game_set=%s",
            (template_id, game_set),
        )
        row = self.fetchone()
        return row if row else None
    def list_items(self, *, template_id: uuid.UUID) -> List[TemplateItemRow]:
        self.execute(
            """
            SELECT title, rating, secret_text, is_target, image_data
            FROM template_items
            WHERE template_id=%s
            ORDER BY title ASC
            """,
            (template_id,),
        )
        return list(self.fetchall() or [])
    def get_full(self, *, template_id: uuid.UUID, game_set: str) -> Optional[tuple[TemplateRow, List[TemplateItemRow]]]:
        tpl = self.get_template(template_id=template_id, game_set=game_set)
        if not tpl:
            return None
        items = self.list_items(template_id=template_id)
        return tpl, items
    def create_template(
        self,
        *,
        game_set: str,
        name: str,
        prompt: str,
        kind: str,
        image_data: Optional[str],
    ) -> uuid.UUID:
        self.execute(
            """
            INSERT INTO templates (game_set, name, prompt, kind, image_data)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (game_set, name.strip(), prompt.strip(), kind, image_data),
        )
        (tpl_id,) = self.fetchone()
        return tpl_id
    def update_template(
        self,
        *,
        template_id: uuid.UUID,
        game_set: str,
        name: str,
        prompt: str,
        kind: str,
        image_data: Optional[str],
    ) -> bool:
        self.execute(
            """
            UPDATE templates
            SET name=%s, prompt=%s, kind=%s, image_data=%s
            WHERE id=%s AND game_set=%s
            """,
            (name.strip(), prompt.strip(), kind, image_data, template_id, game_set),
        )
        return bool(getattr(self.cur, "rowcount", 0))
    def delete_template(self, *, template_id: uuid.UUID, game_set: str) -> int:
        self.execute("DELETE FROM templates WHERE id=%s AND game_set=%s", (template_id, game_set))
        return int(getattr(self.cur, "rowcount", 0))
    def replace_items(
        self,
        *,
        template_id: uuid.UUID,
        kind: str,
        items: Iterable[TemplateItemIn],
    ) -> None:
        self.execute("DELETE FROM template_items WHERE template_id=%s", (template_id,))
        is_manual_like = kind in ("manual", "carousel")
        for it in items:
            title = it.title.strip()
            rating = it.rating if kind == "rated" else None
            secret_text = (it.secret_text.strip() if it.secret_text else None) if is_manual_like else None
            is_target = bool(it.is_target) if is_manual_like else False
            item_image = it.image_data
            self.execute(
                """
                INSERT INTO template_items (template_id, title, rating, secret_text, is_target, image_data)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (template_id, title, rating, secret_text, is_target, item_image),
            )
