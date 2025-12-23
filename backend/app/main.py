from __future__ import annotations

import random
import uuid
from decimal import Decimal
from typing import Any, Dict, List, Optional, Literal

from fastapi import FastAPI, HTTPException, Header, Depends
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
    image_data: Optional[str] = None


class RoundOut(BaseModel):
    id: uuid.UUID
    category: str
    prompt: str
    kind: str
    current_team: int
    status: str
    winner_team: Optional[int] = None
    loser_team: Optional[int] = None
    items: List[ItemOut]
    image_data: Optional[str] = None


# =========================
# Templates / round sets models
# =========================
TemplateKind = Literal["rated", "manual", "carousel"]


class TemplateItemIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    rating: Optional[Decimal] = None          # rated
    secret_text: Optional[str] = None         # manual/carousel (hidden info)
    is_target: bool = False                   # manual/carousel (exactly 1)
    image_data: Optional[str] = None          # per-item image (base64 or data URL)


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

@app.get("/api/game-sets/{name}")
def game_set_exists(name: str) -> dict:
    if len(name) != 6:
        raise HTTPException(status_code=400, detail="Game set name must be exactly 6 characters")

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM game_sets WHERE name=%s", (name,))
            exists = cur.fetchone() is not None

    return {"exists": exists}


@app.post("/api/game-sets/{name}")
def create_game_set(name: str) -> dict:
    if len(name) != 6:
        raise HTTPException(status_code=400, detail="Game set name must be exactly 6 characters")

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO game_sets(name) VALUES (%s) ON CONFLICT DO NOTHING",
                (name,),
            )
        conn.commit()

    return {"created": True}

# =========================
# Helpers
# =========================
def get_game_set(x_game_set: str | None = Header(default=None)) -> str:
    if not x_game_set:
        raise HTTPException(status_code=400, detail="X-Game-Set header is required")

    if len(x_game_set) != 6:
        raise HTTPException(status_code=400, detail="Game set name must be exactly 6 characters")

    return x_game_set

def _validate_template(kind: str, items: List[TemplateItemIn]) -> None:
    if kind not in ("rated", "manual", "carousel"):
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

    targets = [it for it in items if bool(it.is_target)]
    if len(targets) != 1:
        raise HTTPException(
            status_code=400,
            detail="Manual/carousel round: exactly 1 item must be marked as target",
        )

    for it in items:
        if not (it.secret_text and it.secret_text.strip()):
            raise HTTPException(
                status_code=400,
                detail="Manual/carousel round: each item must have hidden info (secret_text)",
            )

    if kind == "carousel":
        for it in items:
            if not (it.image_data and it.image_data.strip()):
                raise HTTPException(
                    status_code=400,
                    detail="Carousel round: each item must have image_data",
                )
            if it.rating is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Carousel round: rating must be null",
                )


def _round_to_response(round_id: uuid.UUID, game_set: str) -> RoundOut:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, category, prompt, kind, current_team, status, target_item_id, winner_team, loser_team, image_data
                FROM rounds
                WHERE id = %s AND game_set = %s
                """,
                (round_id, game_set),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Round not found")

            (
                rid,
                category,
                prompt,
                kind,
                current_team,
                status,
                target_item_id,
                winner_team,
                loser_team,
                image_data,
            ) = row

            cur.execute(
                """
                SELECT id, title, eliminated, rating, secret_text, eliminated_by_team, image_data
                FROM items
                WHERE round_id = %s
                ORDER BY title ASC
                """,
                (rid,),
            )
            items_rows = cur.fetchall()

    reveal_all = status == "finished"

    items: List[ItemOut] = []
    for iid, title, eliminated, rating, secret_text, eliminated_by_team, item_image_data in items_rows:
        show_hidden = reveal_all or bool(eliminated)

        # Carousel reveals images during active play.
        show_image = (str(kind) == "carousel") or show_hidden

        items.append(
            ItemOut(
                id=iid,
                title=title,
                eliminated=bool(eliminated),
                eliminated_by_team=int(eliminated_by_team) if eliminated_by_team is not None else None,
                rating=rating if (show_hidden and rating is not None) else None,
                secret_text=secret_text if (show_hidden and secret_text is not None) else None,
                image_data=item_image_data if (show_image and item_image_data is not None) else None,
                is_target=(iid == target_item_id) if reveal_all else None,
            )
        )

    return RoundOut(
        id=rid,
        category=category,
        prompt=prompt,
        kind=str(kind),
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
def create_round(req: CreateRoundRequest, game_set: str = Depends(get_game_set),) -> Any:
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
                INSERT INTO rounds (game_set, category, prompt, kind, current_team, status, target_item_id)
                VALUES (%s, %s, %s, 'rated', 1, 'active', '00000000-0000-0000-0000-000000000000')
                RETURNING id
                """,
                (game_set, category, prompt),
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

    return _round_to_response(round_id, game_set)


@app.get("/api/rounds/{round_id}", response_model=RoundOut)
def get_round(round_id: uuid.UUID, game_set: str = Depends(get_game_set)) -> Any:
    return _round_to_response(round_id, game_set)


@app.post("/api/rounds/{round_id}/eliminate", response_model=RoundOut)
def eliminate(round_id: uuid.UUID, req: EliminateRequest, game_set: str = Depends(get_game_set)) -> Any:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT current_team, status, target_item_id
                FROM rounds
                WHERE id = %s AND game_set = %s
                """,
                (round_id, game_set),
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

            # Picked the target -> immediate loss for current team.
            if req.item_id == target_item_id:
                loser = int(current_team)
                winner = 2 if loser == 1 else 1
                cur.execute(
                    """
                    UPDATE rounds
                    SET status='finished', winner_team=%s, loser_team=%s
                    WHERE id=%s AND game_set=%s
                    """,
                    (winner, loser, round_id, game_set),
                )
                conn.commit()
                return _round_to_response(round_id, game_set)

            # Check remaining items
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
                        WHERE id=%s AND game_set=%s
                        """,
                        (round_id, game_set),
                    )
                    conn.commit()
                    return _round_to_response(round_id, game_set)

                winner = int(current_team)
                loser = 2 if winner == 1 else 1
                cur.execute(
                    """
                    UPDATE rounds
                    SET status='finished', winner_team=%s, loser_team=%s
                    WHERE id=%s AND game_set=%s
                    """,
                    (winner, loser, round_id, game_set),
                )
                conn.commit()
                return _round_to_response(round_id, game_set)

            next_team = 2 if int(current_team) == 1 else 1
            cur.execute(
                "UPDATE rounds SET current_team=%s WHERE id=%s AND game_set=%s",
                (next_team, round_id, game_set),
            )

        conn.commit()

    return _round_to_response(round_id, game_set)


# =========================
# Templates endpoints
# =========================
@app.get("/api/templates", response_model=Dict[str, List[TemplateSummary]])
def list_templates(game_set: str = Depends(get_game_set)) -> Dict[str, List[TemplateSummary]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
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
def get_template(template_id: uuid.UUID, game_set: str = Depends(get_game_set),) -> Any:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, prompt, kind, image_data FROM templates WHERE id=%s AND game_set=%s",
                (template_id, game_set),
            )
            tpl = cur.fetchone()
            if not tpl:
                raise HTTPException(status_code=404, detail="Template not found")

            cur.execute(
                """
                SELECT title, rating, secret_text, is_target, image_data
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


@app.post("/api/templates", response_model=TemplateOut)
def create_template(body: TemplateCreate, game_set: str = Depends(get_game_set),) -> Any:
    _validate_template(body.kind, body.items)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO templates (game_set, name, prompt, kind, image_data)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (game_set, body.name.strip(), body.prompt.strip(), body.kind, body.image_data),
            )
            (tpl_id,) = cur.fetchone()

            for it in body.items:
                is_manual_like = body.kind in ("manual", "carousel")

                rating = it.rating if body.kind == "rated" else None
                secret_text = (it.secret_text.strip() if it.secret_text else None) if is_manual_like else None
                is_target = bool(it.is_target) if is_manual_like else False
                item_image = it.image_data

                cur.execute(
                    """
                    INSERT INTO template_items (template_id, title, rating, secret_text, is_target, image_data)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (tpl_id, it.title.strip(), rating, secret_text, is_target, item_image),
                )

        conn.commit()

    return get_template(tpl_id, game_set)


@app.put("/api/templates/{template_id}", response_model=TemplateOut)
def update_template(template_id: uuid.UUID, body: TemplateCreate, game_set: str = Depends(get_game_set),) -> Any:
    _validate_template(body.kind, body.items)

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM templates WHERE id=%s AND game_set=%s", (template_id, game_set))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Template not found")

            cur.execute(
                """
                UPDATE templates
                SET name=%s, prompt=%s, kind=%s, image_data=%s
                WHERE id=%s AND game_set=%s
                """,
                (body.name.strip(), body.prompt.strip(), body.kind, body.image_data, template_id, game_set)
            )

            cur.execute("DELETE FROM template_items WHERE template_id=%s", (template_id,))

            for it in body.items:
                is_manual_like = body.kind in ("manual", "carousel")

                rating = it.rating if body.kind == "rated" else None
                secret_text = (it.secret_text.strip() if it.secret_text else None) if is_manual_like else None
                is_target = bool(it.is_target) if is_manual_like else False
                item_image = it.image_data

                cur.execute(
                    """
                    INSERT INTO template_items (template_id, title, rating, secret_text, is_target, image_data)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (template_id, it.title.strip(), rating, secret_text, is_target, item_image),
                )

        conn.commit()

    return get_template(template_id, game_set)


@app.delete("/api/templates/{template_id}")
def delete_template(template_id: uuid.UUID, game_set: str = Depends(get_game_set),) -> Dict[str, str]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM templates WHERE id=%s AND game_set=%s", (template_id, game_set))
        conn.commit()
    return {"status": "deleted"}


# =========================
# Create runtime round from template (rated/manual/carousel)
# =========================
@app.post("/api/rounds/from-template", response_model=RoundOut)
def create_round_from_template(
    req: CreateRoundFromTemplateRequest,
    game_set: str = Depends(get_game_set),
) -> Any:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, prompt, kind, image_data FROM templates WHERE id=%s AND game_set=%s",
                (req.template_id, game_set),
            )
            tpl = cur.fetchone()
            if not tpl:
                raise HTTPException(status_code=404, detail="Template not found")

            tpl_id, name, prompt, kind, image_data = tpl

            cur.execute(
                """
                SELECT title, rating, secret_text, is_target, image_data
                FROM template_items
                WHERE template_id=%s
                ORDER BY title ASC
                """,
                (tpl_id,),
            )
            rows = cur.fetchall()

    items_obj = [
        TemplateItemIn(
            title=t,
            rating=r,
            secret_text=s,
            is_target=bool(is_target),
            image_data=img,
        )
        for (t, r, s, is_target, img) in rows
    ]
    _validate_template(str(kind), items_obj)

    if str(kind) == "rated":
        target_title = min(rows, key=lambda x: x[1])[0]
    else:
        target_title = [r[0] for r in rows if bool(r[3])][0]

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO rounds (game_set, category, prompt, kind, image_data, current_team, status, target_item_id)
                VALUES (%s, %s, %s, %s, %s, 1, 'active', '00000000-0000-0000-0000-000000000000')
                RETURNING id
                """,
                (game_set, str(name), str(prompt), str(kind), image_data),
            )
            (round_id,) = cur.fetchone()

            target_item_id: Optional[uuid.UUID] = None
            kind_s = str(kind)

            for (title, rating, secret_text, is_target, item_image_data) in rows:
                ins_rating = rating if kind_s == "rated" else None
                ins_secret = secret_text if kind_s in ("manual", "carousel") else None
                ins_image = item_image_data if item_image_data else None

                cur.execute(
                    """
                    INSERT INTO items (round_id, title, rating, secret_text, image_data, eliminated)
                    VALUES (%s, %s, %s, %s, %s, false)
                    RETURNING id
                    """,
                    (round_id, title, ins_rating, ins_secret, ins_image),
                )
                (iid,) = cur.fetchone()

                if kind_s == "rated":
                    if title == target_title:
                        target_item_id = iid
                else:
                    if bool(is_target):
                        target_item_id = iid

            if target_item_id is None:
                raise HTTPException(status_code=500, detail="Failed to resolve target_item_id")

            cur.execute(
                "UPDATE rounds SET target_item_id=%s WHERE id=%s AND game_set=%s",
                (target_item_id, round_id, game_set),
            )
        conn.commit()

    return _round_to_response(round_id, game_set)


@app.exception_handler(HTTPException)
def http_exception_handler(_, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

