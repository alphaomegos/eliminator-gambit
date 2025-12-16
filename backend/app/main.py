from __future__ import annotations

import random
import uuid
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .db import db_conn, init_pool
from .datasets import DATASETS, list_categories

app = FastAPI(title="The Eliminator’s Gambit API", version="0.1.0")


class CreateRoundRequest(BaseModel):
    category: str = Field(default="movies")


class EliminateRequest(BaseModel):
    item_id: uuid.UUID


class ItemOut(BaseModel):
    id: uuid.UUID
    title: str
    eliminated: bool
    rating: Optional[Decimal] = None
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


@app.on_event("startup")
def _startup() -> None:
    init_pool()


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/categories")
def categories() -> Dict[str, List[str]]:
    return {"categories": list_categories()}


def _round_to_response(round_id: uuid.UUID) -> RoundOut:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, category, prompt, current_team, status, target_item_id, winner_team, loser_team
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
            ) = row

            cur.execute(
                """
                SELECT id, title, eliminated, rating
                FROM items
                WHERE round_id = %s
                ORDER BY title ASC
                """,
                (rid,),
            )
            items_rows = cur.fetchall()

    reveal_all = status == "finished"

    items: List[ItemOut] = []
    for iid, title, eliminated, rating in items_rows:
        show_rating = reveal_all or bool(eliminated)

        items.append(
            ItemOut(
                id=iid,
                title=title,
                eliminated=bool(eliminated),
                rating=rating if show_rating else None,
                is_target=(iid == target_item_id) if reveal_all else None,
            )
        )

    return RoundOut(
        id=rid,
        category=category,
        prompt=prompt,
        current_team=current_team,
        status=status,
        winner_team=winner_team,
        loser_team=loser_team,
        items=items,
    )


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
                    INSERT INTO items (round_id, title, rating, eliminated)
                    VALUES (%s, %s, %s, false)
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

            next_team = 2 if int(current_team) == 1 else 1
            cur.execute(
                "UPDATE rounds SET current_team=%s WHERE id=%s",
                (next_team, round_id),
            )
        conn.commit()

    return _round_to_response(round_id)


@app.exception_handler(HTTPException)
def http_exception_handler(_, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

