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

_orchestrators: Dict[str, PipelineOrchestrator] = {}
_scheduler = None


def get_orchestrators() -> Dict[str, PipelineOrchestrator]:
    return _orchestrators


def get_orchestrator(counter_id: Optional[str] = None) -> Optional[PipelineOrchestrator]:
    if counter_id:
        return _orchestrators.get(counter_id)
    if _orchestrators:
        if "default" in _orchestrators:
            return _orchestrators["default"]
        return list(_orchestrators.values())[0]
    return None


# ─────────────────────────────────────────────────────────
# Lifespan
# ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _orchestrators, _scheduler

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

        # Self-healing: Ensure standard_greeting is dynamically added to existing databases
        categories = runtime_config.get("fraud_categories", [])
        has_greeting = any(c.get("key") == "standard_greeting" for c in categories)
        if not has_greeting:
            logger.info("[Startup] Adding 'standard_greeting' to fraud_categories dynamically")
            categories.append({
                "key": "standard_greeting",
                "label": "Standard Greeting",
                "description": "Petugas mengucapkan salam pembuka resmi sesuai standar (seperti mengucapkan salam, menanyakan kabar, atau menawarkan bantuan di awal percakapan)",
                "classification": "NORMAL"
            })
            runtime_config.set("fraud_categories", categories)
            
            # Recompile prompt
            from config import compile_system_prompt, _DEFAULT_SYSTEM_PROMPT_BASE
            base_prompt = runtime_config.get("system_prompt_base", _DEFAULT_SYSTEM_PROMPT_BASE)
            compiled_prompt = compile_system_prompt(base_prompt, categories)
            runtime_config.set("system_prompt", compiled_prompt)
            
            # Persist update
            import json
            for key, val in [("fraud_categories", categories), ("system_prompt", compiled_prompt)]:
                db_entry = await db.get(ConfigEntry, key)
                if db_entry:
                    db_entry.value = json.dumps(val)
                else:
                    db.add(ConfigEntry(key=key, value=json.dumps(val)))
            await db.commit()
            logger.info("[Startup] Successfully persisted dynamic standard_greeting category to DB")

    # 5. Init pipelines
    db_writer = DBWriter()
    counters = runtime_config.get("counters", [])
    if not counters:
        counters = [{"id": "default", "name": "Default Counter", "audio_device_index": -1, "enabled": True}]
    
    loop = asyncio.get_running_loop()
    for c in counters:
        if not c.get("enabled", True):
            continue
        c_id = c["id"]
        c_name = c["name"]
        c_device = c.get("audio_device_index", -1)
        
        orch = PipelineOrchestrator(
            settings=settings,
            runtime_config=runtime_config,
            broadcast_fn=ws_manager.broadcast,
            db_writer=db_writer,
            counter_id=c_id,
            counter_name=c_name,
            override_device_index=c_device,
        )
        _orchestrators[c_id] = orch
        orch.start(loop)

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
    for orch in list(_orchestrators.values()):
        orch.stop()
    _orchestrators.clear()
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
async def pipeline_start(counter_id: Optional[str] = None, _: User = Depends(get_current_user)):
    loop = asyncio.get_running_loop()
    db_writer = DBWriter()
    
    counters = runtime_config.get("counters", [])
    if not counters:
        counters = [{"id": "default", "name": "Default Counter", "audio_device_index": -1, "enabled": True}]
        
    target_counters = [c for c in counters if c.get("enabled", True)]
    if counter_id:
        target_counters = [c for c in target_counters if c["id"] == counter_id]
        if not target_counters:
            return {"message": f"Counter {counter_id} not found or disabled"}

    for c in target_counters:
        c_id = c["id"]
        c_name = c["name"]
        c_device = c.get("audio_device_index", -1)
        
        orch = _orchestrators.get(c_id)
        if orch and orch.is_running:
            continue
        
        if not orch:
            orch = PipelineOrchestrator(
                settings=settings,
                runtime_config=runtime_config,
                broadcast_fn=ws_manager.broadcast,
                db_writer=db_writer,
                counter_id=c_id,
                counter_name=c_name,
                override_device_index=c_device,
            )
            _orchestrators[c_id] = orch
        orch.start(loop)
        
    return {"message": "Pipeline started", "started": [c["id"] for c in target_counters]}


@app.post("/api/pipeline/stop")
async def pipeline_stop(counter_id: Optional[str] = None, _: User = Depends(get_current_user)):
    loop = asyncio.get_running_loop()
    
    if counter_id:
        orch = _orchestrators.get(counter_id)
        if orch:
            await loop.run_in_executor(None, orch.stop)
            del _orchestrators[counter_id]
        return {"message": f"Pipeline stopped for counter {counter_id}"}
    else:
        for c_id, orch in list(_orchestrators.items()):
            await loop.run_in_executor(None, orch.stop)
        _orchestrators.clear()
        return {"message": "All pipelines stopped"}


@app.get("/api/pipeline/status")
async def pipeline_status(_: User = Depends(get_current_user)):
    counters = runtime_config.get("counters", [])
    if not counters:
        counters = [{"id": "default", "name": "Default Counter", "audio_device_index": -1, "enabled": True}]
        
    status_map = {}
    for c in counters:
        c_id = c["id"]
        orch = _orchestrators.get(c_id)
        if orch:
            status_map[c_id] = {
                "id": c_id,
                "name": c["name"],
                "enabled": c.get("enabled", True),
                "running": orch.is_running,
                "stats": orch.stats,
            }
        else:
            status_map[c_id] = {
                "id": c_id,
                "name": c["name"],
                "enabled": c.get("enabled", True),
                "running": False,
                "stats": {},
            }
            
    first_orch = get_orchestrator()
    return {
        "running": any(o.is_running for o in _orchestrators.values()),
        "stats": first_orch.stats if first_orch else {},
        "counters": status_map,
    }


# ─────────────────────────────────────────────────────────
# Health check (no auth required)
# ─────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "pipeline_running": any(o.is_running for o in _orchestrators.values()),
        "ws_clients": ws_manager.client_count,
    }
