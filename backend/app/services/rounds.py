from __future__ import annotations

import random
import uuid
from typing import List
from fastapi import HTTPException

from ..datasets import DATASETS
from ..db_utils import run_in_db, run_in_tx
from ..repos.items import ItemRepo
from ..repos.rounds import RoundRepo
from ..repos.templates import TemplateRepo
from ..schemas import ItemOut, RoundOut, STATUS_ACTIVE, STATUS_FINISHED, TemplateItemIn
from ..validators import validate_template

def other_team(team: int) -> int:
    return 2 if int(team) == 1 else 1

def winner_loser_from_loser(loser_team: int) -> tuple[int, int]:
    loser = int(loser_team)
    winner = other_team(loser)
    return winner, loser

def round_to_response(round_id: uuid.UUID, game_set: str) -> RoundOut:
    def load(cur: object):
        repo = RoundRepo(cur)
        row = repo.get_round_details(round_id=round_id, game_set=game_set)
        if not row:
            raise HTTPException(status_code=404, detail="Round not found")
        items_rows = repo.list_round_items(round_id=row[0])
        return row, items_rows
    row, items_rows = run_in_db(load)
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
    reveal_all = str(status) == STATUS_FINISHED
    items: List[ItemOut] = []
    for iid, title, eliminated, rating, secret_text, eliminated_by_team, item_image_data in items_rows:
        show_hidden = reveal_all or bool(eliminated)
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

def create_rated_round_from_dataset(*, category: str, game_set: str) -> uuid.UUID:
    cat = category.strip().lower()
    if cat not in DATASETS:
        raise HTTPException(status_code=400, detail="Unknown category")
    prompt = str(DATASETS[cat]["prompt"])
    source_items = list(DATASETS[cat]["items"])
    if len(source_items) < 11:
        raise HTTPException(status_code=500, detail="Dataset must have at least 11 items")
    picked = random.sample(source_items, 11)
    target = min(picked, key=lambda x: (x.rating, x.title))
    def tx(cur: object) -> uuid.UUID:
        round_repo = RoundRepo(cur)
        item_repo = ItemRepo(cur)
        round_id = round_repo.create_round(
            game_set=game_set,
            category=cat,
            prompt=prompt,
            kind="rated",
            current_team=1,
            status=STATUS_ACTIVE,
            image_data=None,
        )
        title_to_id: dict[str, uuid.UUID] = {}
        for it in picked:
            iid = item_repo.insert_item(
                round_id=round_id,
                title=it.title,
                rating=it.rating,
                secret_text=None,
                image_data=None,
            )
            title_to_id[it.title] = iid
        target_item_id = title_to_id.get(target.title)
        if target_item_id is None:
            raise HTTPException(status_code=500, detail="Failed to resolve target_item_id")
        round_repo.set_target_item_id(round_id=round_id, game_set=game_set, target_item_id=target_item_id)
        return round_id
    return run_in_tx(tx)

def create_round_from_template_id(*, template_id: uuid.UUID, game_set: str) -> uuid.UUID:
    def tx(cur: object) -> uuid.UUID:
        tpl_repo = TemplateRepo(cur)
        full = tpl_repo.get_full(template_id=template_id, game_set=game_set)
        if not full:
            raise HTTPException(status_code=404, detail="Template not found")
        tpl, item_rows = full
        _tpl_id, _name, prompt, kind, image_data = tpl
        items_models = [
            TemplateItemIn(
                title=title,
                rating=rating,
                secret_text=secret_text,
                is_target=bool(is_target),
                image_data=item_image_data,
            )
            for (title, rating, secret_text, is_target, item_image_data) in item_rows
        ]
        validate_template(str(kind), items_models)
        round_repo = RoundRepo(cur)
        item_repo = ItemRepo(cur)
        round_id = round_repo.create_round(
            game_set=game_set,
            category="templates",
            prompt=prompt,
            kind=str(kind),
            current_team=1,
            status=STATUS_ACTIVE,
            image_data=image_data,
        )
        target_item_id: uuid.UUID | None = None
        if str(kind) == "rated":
            for it in items_models:
                item_repo.insert_item(
                    round_id=round_id,
                    title=it.title,
                    rating=it.rating,
                    secret_text=it.secret_text,
                    image_data=it.image_data,
                )
            target_item_id = item_repo.find_min_rating_item_id(round_id=round_id)
        else:
            for it in items_models:
                iid = item_repo.insert_item(
                    round_id=round_id,
                    title=it.title,
                    rating=it.rating,
                    secret_text=it.secret_text,
                    image_data=it.image_data,
                )
                if it.is_target:
                    target_item_id = iid
        if target_item_id is None:
            raise HTTPException(status_code=500, detail="Failed to resolve target_item_id")
        round_repo.set_target_item_id(round_id=round_id, game_set=game_set, target_item_id=target_item_id)
        return round_id
    return run_in_tx(tx)

def eliminate_item_in_round(*, round_id: uuid.UUID, item_id: uuid.UUID, game_set: str) -> RoundOut:
    def tx(cur: object) -> None:
        repo = RoundRepo(cur)
        row = repo.get_round_state(round_id=round_id, game_set=game_set)
        if not row:
            raise HTTPException(status_code=404, detail="Round not found")
        _rid, _kind, status, current_team, target_item_id = row
        if str(status) != STATUS_ACTIVE:
            raise HTTPException(status_code=409, detail="Round already finished")
        item_row = repo.get_item_eliminated_flag(item_id=item_id, round_id=round_id)
        if not item_row:
            raise HTTPException(status_code=404, detail="Item not found")
        if bool(item_row[0]):
            raise HTTPException(status_code=409, detail="Item already eliminated")
        repo.eliminate_item(item_id=item_id, round_id=round_id, team=int(current_team))
        if item_id == target_item_id:
            loser = int(current_team)
            winner, loser = winner_loser_from_loser(loser)
            repo.finish_round(round_id=round_id, game_set=game_set, winner_team=winner, loser_team=loser)
            return
        remaining = int(repo.count_remaining_items(round_id=round_id))
        if remaining == 1:
            remaining_item_id = repo.get_last_remaining_item_id(round_id=round_id)
            if remaining_item_id == target_item_id:
                repo.finish_round(round_id=round_id, game_set=game_set, winner_team=None, loser_team=None)
                return
            winner = int(current_team)
            loser = other_team(winner)
            repo.finish_round(round_id=round_id, game_set=game_set, winner_team=winner, loser_team=loser)
            return
        next_team = other_team(int(current_team))
        repo.set_current_team(round_id=round_id, game_set=game_set, team=next_team)
    run_in_tx(tx)
    return round_to_response(round_id, game_set)
