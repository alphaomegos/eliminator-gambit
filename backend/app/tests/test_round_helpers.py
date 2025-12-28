import pytest
from app.services.rounds import other_team, winner_loser_from_loser

pytestmark = pytest.mark.unit

def test_other_team() -> None:
    assert other_team(1) == 2
    assert other_team(2) == 1

def test_winner_loser_from_loser() -> None:
    assert winner_loser_from_loser(1) == (2, 1)
    assert winner_loser_from_loser(2) == (1, 2)
