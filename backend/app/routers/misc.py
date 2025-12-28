from __future__ import annotations
from typing import Dict, List
from fastapi import APIRouter
from ..datasets import list_categories

router = APIRouter(prefix="/api", tags=["misc"])

@router.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}

@router.get("/categories")
def categories() -> Dict[str, List[str]]:
    return {"categories": list_categories()}
