import pytest
from fastapi import HTTPException
from app.routers.game_sets import validate_game_set_name

pytestmark = pytest.mark.unit

def test_validate_game_set_name_ok() -> None:
    assert validate_game_set_name("ABCDEF") == "ABCDEF"
    assert validate_game_set_name("  ABCDEF  ") == "ABCDEF"

@pytest.mark.parametrize("name", ["", "A", "ABCDE", "ABCDEFG", "     "])
def test_validate_game_set_name_rejects_bad_length(name: str) -> None:
    with pytest.raises(HTTPException) as exc:
        validate_game_set_name(name)
    assert exc.value.status_code == 400
