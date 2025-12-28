from __future__ import annotations

import uuid

from decimal import Decimal
from typing import List, Optional, Literal

from pydantic import BaseModel, Field, conlist


TemplateKind = Literal["rated", "manual", "carousel"]
RoundKind = TemplateKind

RoundStatus = Literal["active", "finished"]
STATUS_ACTIVE: RoundStatus = "active"
STATUS_FINISHED: RoundStatus = "finished"

TeamId = Literal[1, 2]


class CreateRoundRequest(BaseModel):
    category: str = Field(default="movies")


class EliminateRequest(BaseModel):
    item_id: uuid.UUID


class ItemOut(BaseModel):
    id: uuid.UUID
    title: str
    eliminated: bool
    eliminated_by_team: Optional[TeamId] = None
    rating: Optional[Decimal] = None
    secret_text: Optional[str] = None
    is_target: Optional[bool] = None
    image_data: Optional[str] = None


class RoundOut(BaseModel):
    id: uuid.UUID
    category: str
    prompt: str
    kind: RoundKind
    current_team: TeamId
    status: RoundStatus
    winner_team: Optional[TeamId] = None
    loser_team: Optional[TeamId] = None
    items: List[ItemOut]
    image_data: Optional[str] = None


class TemplateItemIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    rating: Optional[Decimal] = None
    secret_text: Optional[str] = None
    is_target: bool = False
    image_data: Optional[str] = None


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

