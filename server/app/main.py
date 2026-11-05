"""BolBridge translation server.

Run:  uvicorn app.main:app --reload --port 8000   (from the server/ folder)
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import SERVER_DIR, Settings
from .db import Database
from .engines import Engines, build_engines
from .languages import public_list
from .pipeline import TranslationPipeline
from .realtime.ws import router as ws_router
from .routers.account import router as account_router
from .routers.testcall import router as testcall_router
from .routers.auth import router as auth_router
from .routers.voice import router as voice_router

__version__ = "0.3.0"


def create_app(settings: Settings | None = None, engines: Engines | None = None) -> FastAPI:
    if settings is None:
        load_dotenv(SERVER_DIR / ".env")
        settings = Settings.from_env()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    db = Database(settings.database_url)
    db.create_all()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if getattr(app.state, "engines", None) is None:
            app.state.engines = build_engines(settings)  # loads models once, at startup
            app.state.pipeline = TranslationPipeline(app.state.engines)
        if settings.warmup_langs:
            try:
                took = await asyncio.get_running_loop().run_in_executor(None, app.state.pipeline.warm_up, settings.warmup_langs)
                logging.getLogger(__name__).info("Warm-up done (ms per language): %s", took)
            except Exception:
                logging.getLogger(__name__).exception("Warm-up failed; the first sentences will be slower")
        yield

    app = FastAPI(title="BolBridge API", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.db = db
    if engines is not None:
        app.state.engines = engines
        app.state.pipeline = TranslationPipeline(engines)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"chrome-extension://[a-p]{32}",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Test-Sentence"],
    )

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        eng = getattr(app.state, "engines", None)
        return {
            "ok": True,
            "version": __version__,
            "preset": settings.engine_preset,
            "engines": eng.describe() if eng else None,
            "voice_clone": bool(eng and eng.voice.available()),
            "free_plan_switching": settings.dev_mode,
        }

    @app.get("/api/languages", tags=["meta"])
    def languages() -> list[dict]:
        return public_list()

    app.include_router(auth_router)
    app.include_router(account_router)
    app.include_router(voice_router)
    app.include_router(testcall_router)
    app.include_router(ws_router)

    if settings.web_dist:
        mount_web_app(app, Path(settings.web_dist))
    return app


def mount_web_app(app: FastAPI, folder: Path) -> None:
    """Serve the built web app (web/dist) from this server, so one address serves everything.

    Used when there is no Caddy/nginx in front, e.g. when going live from a laptop
    through a Cloudflare Tunnel. Unknown paths get index.html (the app has its own router).
    """
    from starlette.exceptions import HTTPException as StarletteHTTPException
    from starlette.staticfiles import StaticFiles

    index = folder / "index.html"
    if not index.is_file():
        logging.getLogger(__name__).warning("WEB_DIST=%s has no index.html; not serving the web app", folder)
        return

    class SinglePageApp(StaticFiles):
        async def get_response(self, path, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code != 404 or path.startswith(("api/", "ws/")):
                    raise  # a wrong API address should say 404, not return the web page
                return await super().get_response("index.html", scope)

    app.mount("/", SinglePageApp(directory=folder, html=True), name="web")


app = create_app()
