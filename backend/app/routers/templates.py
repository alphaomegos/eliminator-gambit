from __future__ import annotations
import uuid
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException
from ..db import db_conn
from ..repos.templates import TemplateRepo
from ..deps import get_game_set
from ..schemas import TemplateCreate, TemplateItemIn, TemplateOut, TemplateSummary
from ..validators import validate_template

router = APIRouter(prefix="/api/templates", tags=["templates"])

@router.get("", response_model=Dict[str, List[TemplateSummary]])
def list_templates(game_set: str = Depends(get_game_set)) -> Dict[str, List[TemplateSummary]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            repo = TemplateRepo(cur)
            rows = repo.list_summaries(game_set=game_set)
    return {
        "templates": [
            TemplateSummary(
                id=r[0],
                name=r[1],
                prompt=r[2],
                kind=r[3],
                item_count=int(r[4]),
            )
            for r in rows
        ]
    }

@router.get("/{template_id}", response_model=TemplateOut)
def get_template(template_id: uuid.UUID, game_set: str = Depends(get_game_set)) -> Any:
    with db_conn() as conn:
        with conn.cursor() as cur:
            repo = TemplateRepo(cur)
            full = repo.get_full(template_id=template_id, game_set=game_set)
            if not full:
                raise HTTPException(status_code=404, detail="Template not found")
            tpl, items = full
    return TemplateOut(
        id=tpl[0],
        name=tpl[1],
        prompt=tpl[2],
        kind=tpl[3],
        image_data=tpl[4],
        items=[
            TemplateItemIn(
                title=t,
                rating=r,
                secret_text=s,
                is_target=bool(is_target),
                image_data=img,
            )
            for (t, r, s, is_target, img) in items
        ],
    )

@router.post("", response_model=TemplateOut)
def create_template(body: TemplateCreate, game_set: str = Depends(get_game_set)) -> Any:
    validate_template(body.kind, body.items)
    with db_conn() as conn:
        with conn.cursor() as cur:
            repo = TemplateRepo(cur)
            tpl_id = repo.create_template(
                game_set=game_set,
                name=body.name,
                prompt=body.prompt,
                kind=body.kind,
                image_data=body.image_data,
            )
            repo.replace_items(template_id=tpl_id, kind=body.kind, items=body.items)
        conn.commit()
    return get_template(tpl_id, game_set)

@router.put("/{template_id}", response_model=TemplateOut)
def update_template(template_id: uuid.UUID, body: TemplateCreate, game_set: str = Depends(get_game_set)) -> Any:
    validate_template(body.kind, body.items)
    with db_conn() as conn:
        with conn.cursor() as cur:
            repo = TemplateRepo(cur)
            updated = repo.update_template(
                template_id=template_id,
                game_set=game_set,
                name=body.name,
                prompt=body.prompt,
                kind=body.kind,
                image_data=body.image_data,
            )
            if not updated:
                raise HTTPException(status_code=404, detail="Template not found")
            repo.replace_items(template_id=template_id, kind=body.kind, items=body.items)
        conn.commit()
    return get_template(template_id, game_set)

@router.delete("/{template_id}")
def delete_template(template_id: uuid.UUID, game_set: str = Depends(get_game_set)) -> Dict[str, str]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            repo = TemplateRepo(cur)
            deleted = repo.delete_template(template_id=template_id, game_set=game_set)
        conn.commit()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"status": "deleted"}
