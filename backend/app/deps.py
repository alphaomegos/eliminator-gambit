from fastapi import Header, HTTPException

def _validate_game_set(name: str | None) -> str:
    if not name:
        raise HTTPException(status_code=400, detail="X-Game-Set header is required")
    if len(name) != 6:
        raise HTTPException(status_code=400, detail="Game set name must be exactly 6 characters")
    return name

def get_game_set(x_game_set: str | None = Header(default=None)) -> str:
    return _validate_game_set(x_game_set)
