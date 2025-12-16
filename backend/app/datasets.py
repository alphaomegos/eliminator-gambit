from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, List


@dataclass(frozen=True)
class DatasetItem:
    title: str
    rating: Decimal


DATASETS: Dict[str, Dict[str, object]] = {
    "movies": {
        "prompt": "Find the lowest-rated movie.",
        "items": [
            DatasetItem("The Room (2003)", Decimal("3.7")),
            DatasetItem("Batman & Robin (1997)", Decimal("3.8")),
            DatasetItem("Cats (2019)", Decimal("2.8")),
            DatasetItem("Battlefield Earth (2000)", Decimal("2.5")),
            DatasetItem("Jack and Jill (2011)", Decimal("3.1")),
            DatasetItem("Movie 43 (2013)", Decimal("3.0")),
            DatasetItem("The Last Airbender (2010)", Decimal("4.0")),
            DatasetItem("Gigli (2003)", Decimal("2.6")),
            DatasetItem("Wild Wild West (1999)", Decimal("4.3")),
            DatasetItem("Twilight (2008)", Decimal("5.3")),
            DatasetItem("Morbius (2022)", Decimal("5.2")),
        ],
    }
}


def list_categories() -> List[str]:
    return sorted(DATASETS.keys())

