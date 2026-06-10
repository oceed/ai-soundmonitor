"""
main.py — FastAPI application entry point.

Startup:
  1. Init DB tables
  2. Seed default admin user if not exists
  3. Load runtime config from DB
  4. Start pipeline orchestrator
  5. Start retention scheduler
  6. Start RMS broadcast task

Shutdown:
  1. Stop pipeline
  2. Stop scheduler
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from api.auth import hash_password, router as auth_router
from api.ws import router as ws_router, ws_manager, rms_broadcast_task, device_watcher_task
from api.alerts import router as alerts_router
from api.recordings import router as recordings_router
from api.config_router import router as config_router
from api.devices import router as devices_router
from api.sessions import router as sessions_router
from config import get_settings, runtime_config
from database import AsyncSessionLocal, init_db
from db_writer import DBWriter
from models import ConfigEntry, User
from pipeline.orchestrator import PipelineOrchestrator
from services.retention import RetentionService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────
# Global Singletons
# ─────────────────────────────────────────────────────────

_orchestrator: Optional[PipelineOrchestrator] = None
_scheduler = None


def get_orchestrator() -> Optional[PipelineOrchestrator]:
    return _orchestrator


# ─────────────────────────────────────────────────────────
# Lifespan
# ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _orchestrator, _scheduler

    settings = get_settings()

    # 1. Create storage dirs
    Path(settings.storage_path).mkdir(parents=True, exist_ok=True)
    (Path(settings.storage_path) / "recordings").mkdir(exist_ok=True)

    # 2. Init DB
    await init_db()

    # 3. Seed admin user
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.username == settings.admin_username))
        if result.scalar_one_or_none() is None:
            db.add(User(
                username=settings.admin_username,
                hashed_password=hash_password(settings.admin_password),
            ))
            await db.commit()
            logger.info(f"[Startup] Admin user '{settings.admin_username}' created")

    # 4. Load runtime config from DB
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ConfigEntry))
        rows = [(e.key, e.value) for e in result.scalars().all()]
        runtime_config.load_from_db_rows(rows)
        logger.info(f"[Startup] Loaded {len(rows)} config entries from DB")

    # 5. Init pipeline
    db_writer = DBWriter()
    _orchestrator = PipelineOrchestrator(
        settings=settings,
        runtime_config=runtime_config,
        broadcast_fn=ws_manager.broadcast,
        db_writer=db_writer,
    )
    loop = asyncio.get_running_loop()
    _orchestrator.start(loop)

    # 6. Start background tasks
    rms_task    = asyncio.create_task(rms_broadcast_task())
    device_task = asyncio.create_task(device_watcher_task())

    # 7. Start retention scheduler
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    retention = RetentionService(
        db_writer=db_writer,
        recordings_dir=Path(settings.storage_path) / "recordings",
        runtime_config=runtime_config,
    )
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        lambda: asyncio.get_event_loop().run_in_executor(None, retention.run_cleanup),
        trigger="interval",
        hours=6,
        id="retention_cleanup",
    )
    _scheduler.start()
    logger.info("[Startup] All services started ✓")

    yield

    # ── Shutdown ──────────────────────────────────────────
    logger.info("[Shutdown] Stopping services...")
    rms_task.cancel()
    device_task.cancel()
    if _orchestrator:
        _orchestrator.stop()
    if _scheduler:
        _scheduler.shutdown(wait=False)
    logger.info("[Shutdown] Done.")


# ─────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────

settings = get_settings()

app = FastAPI(
    title="VoiceGuard Fraud Detection API",
    version="1.0.0",
    description="Real-time voice fraud detection by ProtectQube",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list + ["*"],  # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth_router)
app.include_router(ws_router)
app.include_router(alerts_router)
app.include_router(recordings_router)
app.include_router(config_router)
app.include_router(devices_router)
app.include_router(sessions_router)


# ─────────────────────────────────────────────────────────
# Pipeline control endpoints
# ─────────────────────────────────────────────────────────

from fastapi import Depends
from api.auth import get_current_user
from models import User


@app.post("/api/pipeline/start")
async def pipeline_start(_: User = Depends(get_current_user)):
    if _orchestrator and _orchestrator.is_running:
        return {"message": "Pipeline already running"}
    loop = asyncio.get_running_loop()
    _orchestrator.start(loop)
    return {"message": "Pipeline started"}


@app.post("/api/pipeline/stop")
async def pipeline_stop(_: User = Depends(get_current_user)):
    if _orchestrator:
        _orchestrator.stop()
    return {"message": "Pipeline stopped"}


@app.get("/api/pipeline/status")
async def pipeline_status(_: User = Depends(get_current_user)):
    if _orchestrator:
        return {
            "running": _orchestrator.is_running,
            "stats": _orchestrator.stats,
        }
    return {"running": False, "stats": {}}


# ─────────────────────────────────────────────────────────
# Health check (no auth required)
# ─────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "pipeline_running": _orchestrator.is_running if _orchestrator else False,
        "ws_clients": ws_manager.client_count,
    }
