from __future__ import annotations

import random
import uuid
from typing import Any

from fastapi import APIRouter, Depends

from ..validators import validate_template
from ..datasets import DATASETS
from ..deps import get_game_set
from ..schemas import (
    CreateRoundFromTemplateRequest,
    CreateRoundRequest,
    EliminateRequest,
    RoundOut,
    STATUS_ACTIVE,
    STATUS_FINISHED,
)
from ..services.rounds import (
    create_rated_round_from_dataset,
    create_round_from_template_id,
    eliminate_item_in_round,
    round_to_response,
)

router = APIRouter(prefix="/api/rounds", tags=["rounds"])

@router.post("", response_model=RoundOut)
def create_round(req: CreateRoundRequest, game_set: str = Depends(get_game_set)) -> Any:
    round_id = create_rated_round_from_dataset(category=req.category, game_set=game_set)
    return round_to_response(round_id, game_set)

@router.get("/{round_id}", response_model=RoundOut)
def get_round(round_id: uuid.UUID, game_set: str = Depends(get_game_set)) -> Any:
    return round_to_response(round_id, game_set)

@router.post("/{round_id}/eliminate", response_model=RoundOut)
def eliminate(round_id: uuid.UUID, req: EliminateRequest, game_set: str = Depends(get_game_set)) -> Any:
    return eliminate_item_in_round(round_id=round_id, item_id=req.item_id, game_set=game_set)

@router.post("/from-template", response_model=RoundOut)
def create_round_from_template(
    req: CreateRoundFromTemplateRequest,
    game_set: str = Depends(get_game_set),
) -> Any:
    round_id = create_round_from_template_id(template_id=req.template_id, game_set=game_set)
    return round_to_response(round_id, game_set)
