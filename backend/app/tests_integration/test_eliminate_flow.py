import uuid
import psycopg
import pytest

pytestmark = pytest.mark.integration

def _ensure_game_set(client, name: str) -> None:
    r = client.post(f"/api/game-sets/{name}")
    assert r.status_code == 200, r.text

def _pick_category(client) -> str:
    r = client.get("/api/categories")
    assert r.status_code == 200, r.text
    cats = r.json()["categories"]
    assert cats and isinstance(cats, list)
    return cats[0]

def _create_round(client, headers: dict[str, str], category: str) -> uuid.UUID:
    r = client.post("/api/rounds", headers=headers, json={"category": category})
    assert r.status_code == 200, r.text
    rid = uuid.UUID(r.json()["id"])
    return rid

def _get_target_item_id(db_url: str, round_id: uuid.UUID) -> uuid.UUID:
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT target_item_id FROM rounds WHERE id=%s", (round_id,))
            row = cur.fetchone()
    assert row and row[0]
    return row[0]

def _get_non_target_item_ids(db_url: str, round_id: uuid.UUID, target_id: uuid.UUID) -> list[uuid.UUID]:
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM items WHERE round_id=%s AND id<>%s ORDER BY id",
                (round_id, target_id),
            )
            rows = cur.fetchall()
    return [r[0] for r in rows]

def test_eliminate_target_finishes_round_as_loss(client, headers, db_url) -> None:
    _ensure_game_set(client, "ABCDEF")
    category = _pick_category(client)
    round_id = _create_round(client, headers, category)
    target_id = _get_target_item_id(db_url, round_id)
    r = client.post(f"/api/rounds/{round_id}/eliminate", headers=headers, json={"item_id": str(target_id)})
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["status"] == "finished"
    # By rules: first team starts as 1, hitting target => team 1 loses, team 2 wins
    assert payload["winner_team"] == 2
    assert payload["loser_team"] == 1

def test_eliminate_all_but_target_finishes_as_draw(client, headers, db_url) -> None:
    _ensure_game_set(client, "ABCDEF")
    category = _pick_category(client)
    round_id = _create_round(client, headers, category)
    target_id = _get_target_item_id(db_url, round_id)
    non_target_ids = _get_non_target_item_ids(db_url, round_id, target_id)
    assert len(non_target_ids) >= 1
    last_resp = None
    for iid in non_target_ids:
        last_resp = client.post(
            f"/api/rounds/{round_id}/eliminate",
            headers=headers,
            json={"item_id": str(iid)},
        )
        assert last_resp.status_code == 200, last_resp.text

    payload = last_resp.json()
    assert payload["status"] == "finished"
    assert payload["winner_team"] is None
    assert payload["loser_team"] is None
