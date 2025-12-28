import os
import time

import psycopg
import pytest
from fastapi.testclient import TestClient
from app.main import app

GAME_SET = "ABCDEF"

def wait_for_db(db_url: str, timeout_s: float = 30.0) -> None:
    # Wait until Postgres starts accepting connections (compose "run" may start deps without waiting).
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with psycopg.connect(db_url) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            return
        except psycopg.OperationalError as exc:
            last_err = exc
            time.sleep(0.5)
    raise RuntimeError(f"Database is not ready after {timeout_s}s: {last_err}")

@pytest.fixture(scope="session")
def db_url() -> str:
    v = os.environ.get("DATABASE_URL")
    if not v:
        raise RuntimeError("DATABASE_URL is not set")
    return v

@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)

@pytest.fixture()
def headers() -> dict[str, str]:
    return {"X-Game-Set": GAME_SET}

@pytest.fixture(autouse=True)
def clean_rounds(db_url: str) -> None:
    wait_for_db(db_url)
    # Ensure each test starts from a clean state for rounds/items.
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE items, rounds CASCADE")
        conn.commit()
