from __future__ import annotations
from fastapi import APIRouter, HTTPException
from ..db_utils import run_in_db, run_in_tx
from ..repos.game_sets import GameSetRepo

router = APIRouter(prefix="/api/game-sets", tags=["game_sets"])

def validate_game_set_name(name: str) -> str:
    v = name.strip()
    if len(v) != 6:
        raise HTTPException(status_code=400, detail="Game set name must be exactly 6 characters")
    return v

@router.get("/{name}")
def game_set_exists(name: str) -> dict:
    v = validate_game_set_name(name)
    def work(cur: object) -> bool:
        repo = GameSetRepo(cur)
        return repo.exists(name=v)
    return {"exists": run_in_db(work)}

@router.post("/{name}")
def create_game_set(name: str) -> dict:
    v = validate_game_set_name(name)
    def work(cur: object) -> None:
        repo = GameSetRepo(cur)
        repo.create(name=v)
    run_in_tx(work)
    return {"created": True}
