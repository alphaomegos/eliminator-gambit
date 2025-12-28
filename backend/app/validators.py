from fastapi import HTTPException
from .schemas import TemplateItemIn

def validate_template(kind: str, items: list[TemplateItemIn]) -> None:
    if kind not in ("rated", "manual", "carousel"):
        raise HTTPException(status_code=400, detail="Unknown template kind")
    if len(items) < 2:
        raise HTTPException(status_code=400, detail="Template must have at least 2 items")
    if kind == "rated":
        for it in items:
            if it.rating is None:
                raise HTTPException(
                    status_code=400,
                    detail="Rated round: each item must have a numeric rating",
                )
        return
    targets = [it for it in items if bool(it.is_target)]
    if len(targets) != 1:
        raise HTTPException(
            status_code=400,
            detail="Manual/carousel round: exactly 1 item must be marked as target",
        )
    for it in items:
        if not (it.secret_text and it.secret_text.strip()):
            raise HTTPException(
                status_code=400,
                detail="Manual/carousel round: each item must have hidden info (secret_text)",
            )
    if kind == "carousel":
        for it in items:
            if not (it.image_data and it.image_data.strip()):
                raise HTTPException(
                    status_code=400,
                    detail="Carousel round: each item must have image_data",
                )
            if it.rating is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Carousel round: rating must be null",
                )
