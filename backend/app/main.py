from __future__ import annotations

import random
import uuid
from decimal import Decimal
from typing import Any, Dict, List, Optional, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, conlist

from .db import db_conn, init_pool
from .datasets import DATASETS, list_categories

app = FastAPI(title="The Eliminator’s Gambit API", version="0.1.0")


# =========================
# Core round models
# =========================
class CreateRoundRequest(BaseModel):
    category: str = Field(default="movies")


class EliminateRequest(BaseModel):
    item_id: uuid.UUID


class ItemOut(BaseModel):
    id: uuid.UUID
    title: str
    eliminated: bool
    eliminated_by_team: Optional[int] = None
    rating: Optional[Decimal] = None
    secret_text: Optional[str] = None
    is_target: Optional[bool] = None


class RoundOut(BaseModel):
    id: uuid.UUID
    category: str
    prompt: str
    current_team: int
    status: str
    winner_team: Optional[int] = None
    loser_team: Optional[int] = None
    items: List[ItemOut]
    image_data: Optional[str] = None


# =========================
# Templates / round sets models
# =========================
TemplateKind = Literal["rated", "manual"]


class TemplateItemIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    rating: Optional[Decimal] = None          # rated
    secret_text: Optional[str] = None         # manual (hidden info)
    is_target: bool = False                   # manual (exactly 1)


class TemplateCreate(BaseModel):
    kind: TemplateKind = "rated"
    name: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=300)
    items: conlist(TemplateItemIn, min_length=2)
    image_data: Optional[str] = None


class TemplateSummary(BaseModel):
    id: uuid.UUID
    name: str
    prompt: str
    kind: str
    item_count: int


class TemplateOut(BaseModel):
    id: uuid.UUID
    name: str
    prompt: str
    kind: str
    items: List[TemplateItemIn]
    image_data: Optional[str] = None


class CreateRoundFromTemplateRequest(BaseModel):
    template_id: uuid.UUID


# =========================
# Startup / misc
# =========================
@app.on_event("startup")
def _startup() -> None:
    init_pool()


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/categories")
def categories() -> Dict[str, List[str]]:
    return {"categories": list_categories()}


# =========================
# Helpers
# =========================
def _validate_template(kind: str, items: List[TemplateItemIn]) -> None:
    if kind not in ("rated", "manual"):
        raise HTTPException(status_code=400, detail="Unknown template kind")

    if len(items) < 2:
        raise HTTPException(status_code=400, detail="Template must have at least 2 items")

    if kind == "rated":
        for it in items:
            if it.rating is None:
                raise HTTPException(
                    status_code=400,
                    detail="Rated round: each item must have a numeric rating",
                )
        return

    # manual
    targets = [it for it in items if bool(it.is_target)]
    if len(targets) != 1:
        raise HTTPException(
            status_code=400,
            detail="Manual round: exactly 1 item must be marked as target",
        )

    for it in items:
        if not (it.secret_text and it.secret_text.strip()):
            raise HTTPException(
                status_code=400,
                detail="Manual round: each item must have hidden info (secret_text)",
            )


def _round_to_response(round_id: uuid.UUID) -> RoundOut:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, category, prompt, current_team, status, target_item_id, winner_team, loser_team, image_data
                FROM rounds
                WHERE id = %s
                """,
                (round_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Round not found")

            (
                rid,
                category,
                prompt,
                current_team,
                status,
                target_item_id,
                winner_team,
                loser_team,
                image_data,
            ) = row

            cur.execute(
                """
                SELECT id, title, eliminated, rating, secret_text, eliminated_by_team
                FROM items
                WHERE round_id = %s
                ORDER BY title ASC
                """,
                (rid,),
            )
            items_rows = cur.fetchall()

    reveal_all = status == "finished"

    items: List[ItemOut] = []
    for iid, title, eliminated, rating, secret_text, eliminated_by_team in items_rows:
        show_hidden = reveal_all or bool(eliminated)
        items.append(
            ItemOut(
                id=iid,
                title=title,
                eliminated=bool(eliminated),
                eliminated_by_team=int(eliminated_by_team) if eliminated_by_team is not None else None,
                rating=rating if (show_hidden and rating is not None) else None,
                secret_text=secret_text if (show_hidden and secret_text is not None) else None,
                is_target=(iid == target_item_id) if reveal_all else None,
            )
        )

    return RoundOut(
        id=rid,
        category=category,
        prompt=prompt,
        current_team=int(current_team),
        status=str(status),
        winner_team=int(winner_team) if winner_team is not None else None,
        loser_team=int(loser_team) if loser_team is not None else None,
        items=items,
        image_data=image_data,
    )


# =========================
# Core round endpoints
# =========================
@app.post("/api/rounds", response_model=RoundOut)
def create_round(req: CreateRoundRequest) -> Any:
    category = req.category.strip().lower()
    if category not in DATASETS:
        raise HTTPException(status_code=400, detail="Unknown category")

    prompt = str(DATASETS[category]["prompt"])
    source_items = list(DATASETS[category]["items"])  # type: ignore[assignment]
    if len(source_items) < 11:
        raise HTTPException(status_code=500, detail="Dataset must have at least 11 items")

    picked = random.sample(source_items, 11)
    target = min(picked, key=lambda x: x.rating)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO rounds (category, prompt, current_team, status, target_item_id)
                VALUES (%s, %s, 1, 'active', '00000000-0000-0000-0000-000000000000')
                RETURNING id
                """,
                (category, prompt),
            )
            (round_id,) = cur.fetchone()

            item_ids: Dict[str, uuid.UUID] = {}
            for it in picked:
                cur.execute(
                    """
                    INSERT INTO items (round_id, title, rating, secret_text, eliminated)
                    VALUES (%s, %s, %s, NULL, false)
                    RETURNING id
                    """,
                    (round_id, it.title, it.rating),
                )
                (iid,) = cur.fetchone()
                item_ids[it.title] = iid

            target_item_id = item_ids[target.title]
            cur.execute(
                "UPDATE rounds SET target_item_id = %s WHERE id = %s",
                (target_item_id, round_id),
            )

        conn.commit()

    return _round_to_response(round_id)


@app.get("/api/rounds/{round_id}", response_model=RoundOut)
def get_round(round_id: uuid.UUID) -> Any:
    return _round_to_response(round_id)


@app.post("/api/rounds/{round_id}/eliminate", response_model=RoundOut)
def eliminate(round_id: uuid.UUID, req: EliminateRequest) -> Any:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT current_team, status, target_item_id
                FROM rounds
                WHERE id = %s
                """,
                (round_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Round not found")

            current_team, status, target_item_id = row
            if status != "active":
                raise HTTPException(status_code=409, detail="Round already finished")

            cur.execute(
                """
                SELECT eliminated
                FROM items
                WHERE id = %s AND round_id = %s
                """,
                (req.item_id, round_id),
            )
            item_row = cur.fetchone()
            if not item_row:
                raise HTTPException(status_code=404, detail="Item not found")
            if bool(item_row[0]):
                raise HTTPException(status_code=409, detail="Item already eliminated")

            cur.execute(
                """
                UPDATE items
                SET eliminated = true,
                    eliminated_by_team = %s,
                    eliminated_at = now()
                WHERE id = %s AND round_id = %s
                """,
                (current_team, req.item_id, round_id),
            )
            if req.item_id == target_item_id:
                loser = int(current_team)
                winner = 2 if loser == 1 else 1
                cur.execute(
                    """
                    UPDATE rounds
                    SET status='finished', winner_team=%s, loser_team=%s
                    WHERE id=%s
                    """,
                    (winner, loser, round_id),
                )
                conn.commit()
                return _round_to_response(round_id)
            cur.execute(
                """
                SELECT COUNT(*)
                FROM items
                WHERE round_id = %s AND eliminated = false
                """,
                (round_id,),
            )
            (remaining,) = cur.fetchone()
            if int(remaining) == 1:
                # If the last remaining item is the target, it's a tie.
                cur.execute(
                    "SELECT id FROM items WHERE round_id = %s AND eliminated = false",
                    (round_id,),
                )
                remaining_row = cur.fetchone()
                remaining_item_id = remaining_row[0] if remaining_row else None
                if remaining_item_id == target_item_id:
                    cur.execute(
                        """
                        UPDATE rounds
                        SET status='finished', winner_team=NULL, loser_team=NULL
                        WHERE id=%s
                        """,
                        (round_id,),
                    )
                    conn.commit()
                    return _round_to_response(round_id)
                winner = int(current_team)
                loser = 2 if winner == 1 else 1
                cur.execute(
                    """
                    UPDATE rounds
                    SET status='finished', winner_team=%s, loser_team=%s
                    WHERE id=%s
                    """,
                    (winner, loser, round_id),
                )
                conn.commit()
                return _round_to_response(round_id)
                cur.execute(
                    """
                    UPDATE rounds
                    SET status='finished', winner_team=%s, loser_team=%s
                    WHERE id=%s
                    """,
                    (winner, loser, round_id),
                )
                conn.commit()
                return _round_to_response(round_id)

            next_team = 2 if int(current_team) == 1 else 1
            cur.execute(
                "UPDATE rounds SET current_team=%s WHERE id=%s",
                (next_team, round_id),
            )
        conn.commit()

    return _round_to_response(round_id)


# =========================
# Templates endpoints
# =========================
@app.get("/api/templates", response_model=Dict[str, List[TemplateSummary]])
def list_templates() -> Dict[str, List[TemplateSummary]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.id, t.name, t.prompt, t.kind, COUNT(i.id) AS item_count
                FROM templates t
                LEFT JOIN template_items i ON i.template_id = t.id
                GROUP BY t.id, t.name, t.prompt, t.kind
                ORDER BY t.updated_at DESC, t.created_at DESC
                """
            )
            rows = cur.fetchall()

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


@app.get("/api/templates/{template_id}", response_model=TemplateOut)
def get_template(template_id: uuid.UUID) -> Any:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, prompt, kind, image_data FROM templates WHERE id=%s",
                (template_id,),
            )
            tpl = cur.fetchone()
            if not tpl:
                raise HTTPException(status_code=404, detail="Template not found")

            cur.execute(
                """
                SELECT title, rating, secret_text, is_target
                FROM template_items
                WHERE template_id=%s
                ORDER BY title ASC
                """,
                (template_id,),
            )
            items = cur.fetchall()

    return TemplateOut(
        id=tpl[0],
        name=tpl[1],
        prompt=tpl[2],
        kind=tpl[3],
        image_data=tpl[4],
        items=[
            TemplateItemIn(title=t, rating=r, secret_text=s, is_target=bool(is_target))
            for (t, r, s, is_target) in items
        ],
    )


@app.post("/api/templates", response_model=TemplateOut)
def create_template(body: TemplateCreate) -> Any:
    _validate_template(body.kind, body.items)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO templates (name, prompt, kind, image_data)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (body.name.strip(), body.prompt.strip(), body.kind, body.image_data),
            )
            (tpl_id,) = cur.fetchone()

            for it in body.items:
                rating = it.rating if body.kind == "rated" else None
                secret_text = (it.secret_text.strip() if it.secret_text else None) if body.kind == "manual" else None
                is_target = bool(it.is_target) if body.kind == "manual" else False

                cur.execute(
                    """
                    INSERT INTO template_items (template_id, title, rating, secret_text, is_target)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (tpl_id, it.title.strip(), rating, secret_text, is_target),
                )

        conn.commit()

    return get_template(tpl_id)


@app.put("/api/templates/{template_id}", response_model=TemplateOut)
def update_template(template_id: uuid.UUID, body: TemplateCreate) -> Any:
    _validate_template(body.kind, body.items)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM templates WHERE id=%s", (template_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Template not found")

            cur.execute(
                """
                UPDATE templates
                SET name=%s, prompt=%s, kind=%s, image_data=%s
                WHERE id=%s
                """,
                (body.name.strip(), body.prompt.strip(), body.kind, body.image_data, template_id),
            )

            cur.execute("DELETE FROM template_items WHERE template_id=%s", (template_id,))
            for it in body.items:
                rating = it.rating if body.kind == "rated" else None
                secret_text = (it.secret_text.strip() if it.secret_text else None) if body.kind == "manual" else None
                is_target = bool(it.is_target) if body.kind == "manual" else False

                cur.execute(
                    """
                    INSERT INTO template_items (template_id, title, rating, secret_text, is_target)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (template_id, it.title.strip(), rating, secret_text, is_target),
                )

        conn.commit()

    return get_template(template_id)


@app.delete("/api/templates/{template_id}")
def delete_template(template_id: uuid.UUID) -> Dict[str, str]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM templates WHERE id=%s", (template_id,))
        conn.commit()
    return {"status": "deleted"}


# =========================
# Create runtime round from template (rated/manual)
# =========================
@app.post("/api/rounds/from-template", response_model=RoundOut)
def create_round_from_template(req: CreateRoundFromTemplateRequest) -> Any:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, prompt, kind, image_data FROM templates WHERE id=%s",
                (req.template_id,),
            )
            tpl = cur.fetchone()
            if not tpl:
                raise HTTPException(status_code=404, detail="Template not found")

            tpl_id, name, prompt, kind, image_data = tpl

            cur.execute(
                """
                SELECT title, rating, secret_text, is_target
                FROM template_items
                WHERE template_id=%s
                ORDER BY title ASC
                """,
                (tpl_id,),
            )
            rows = cur.fetchall()

    items_obj = [
        TemplateItemIn(title=t, rating=r, secret_text=s, is_target=bool(is_target))
        for (t, r, s, is_target) in rows
    ]
    _validate_template(kind, items_obj)

    # Determine target (losing) item
    if kind == "rated":
        target_title = min(rows, key=lambda x: x[1])[0]  # rating is x[1]
        target_is_manual = False
    else:
        target_title = [r[0] for r in rows if bool(r[3])][0]  # is_target is x[3]
        target_is_manual = True

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO rounds (category, prompt, image_data, current_team, status, target_item_id)
                VALUES (%s, %s, %s, 1, 'active', '00000000-0000-0000-0000-000000000000')
                RETURNING id
                """,
                (str(name), str(prompt), image_data),
            )
            (round_id,) = cur.fetchone()

            target_item_id: Optional[uuid.UUID] = None

            for (title, rating, secret_text, is_target) in rows:
                ins_rating = rating if kind == "rated" else None
                ins_secret = (secret_text if kind == "manual" else None)

                cur.execute(
                    """
                    INSERT INTO items (round_id, title, rating, secret_text, eliminated)
                    VALUES (%s, %s, %s, %s, false)
                    RETURNING id
                    """,
                    (round_id, title, ins_rating, ins_secret),
                )
                (iid,) = cur.fetchone()

                if kind == "rated":
                    if title == target_title:
                        target_item_id = iid
                else:
                    if bool(is_target):
                        target_item_id = iid

            if target_item_id is None:
                raise HTTPException(status_code=500, detail="Failed to resolve target_item_id")

            cur.execute(
                "UPDATE rounds SET target_item_id=%s WHERE id=%s",
                (target_item_id, round_id),
            )

        conn.commit()

    return _round_to_response(round_id)


@app.exception_handler(HTTPException)
def http_exception_handler(_, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
