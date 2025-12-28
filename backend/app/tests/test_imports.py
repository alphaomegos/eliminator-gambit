import pytest
from fastapi import FastAPI
import app.main as main

pytestmark = pytest.mark.unit

def test_main_app_exists() -> None:
    assert isinstance(main.app, FastAPI)
    assert len(main.app.routes) > 0
