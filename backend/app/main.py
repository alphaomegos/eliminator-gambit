from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI
from .db import init_pool
from .routers.game_sets import router as game_sets_router
from .routers.misc import router as misc_router
from .routers.rounds import router as rounds_router
from .routers.templates import router as templates_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    yield

app = FastAPI(
    title="The Eliminator’s Gambit API",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(misc_router)
app.include_router(game_sets_router)
app.include_router(templates_router)
app.include_router(rounds_router)
