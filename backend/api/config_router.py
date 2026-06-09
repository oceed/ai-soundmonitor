"""
config_router.py — Runtime configuration CRUD.

GET  /api/config          → all runtime config
PATCH /api/config         → update one or more keys
POST /api/config/reset    → reset to defaults
GET  /api/config/prompt   → get system prompt
PATCH /api/config/prompt  → update system prompt
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from config import get_settings, runtime_config
from database import get_db
from models import ConfigEntry, User

router = APIRouter(prefix="/api/config", tags=["config"])


class ConfigPatch(BaseModel):
    updates: Dict[str, Any]


class PromptPatch(BaseModel):
    system_prompt: str


# ─────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────

@router.get("")
async def get_config(
    _: User = Depends(get_current_user),
):
    """Return all runtime config (merged with defaults)."""
    cfg = runtime_config.get_all()
    # Mask sensitive values
    for key in ("mqtt_password", "audio_upload_api_key"):
        if cfg.get(key):
            cfg[key] = "***"
    return cfg


@router.patch("")
async def patch_config(
    body: ConfigPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Update runtime config keys. Persists to DB and updates in-memory cache."""
    updates = body.updates
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    # Persist to DB
    for key, value in updates.items():
        value_json = json.dumps(value)
        result = await db.execute(select(ConfigEntry).where(ConfigEntry.key == key))
        entry = result.scalar_one_or_none()
        if entry:
            entry.value = value_json
            entry.updated_at = datetime.utcnow()
        else:
            db.add(ConfigEntry(key=key, value=value_json))

    await db.commit()

    # Update in-memory cache
    runtime_config.update(updates)

    return {"message": "Config updated", "keys": list(updates.keys())}


@router.get("/prompt")
async def get_prompt(
    _: User = Depends(get_current_user),
):
    return {
        "system_prompt": runtime_config.get("system_prompt", ""),
        "fraud_categories": runtime_config.get("fraud_categories", []),
        "alert_verdicts": runtime_config.get("alert_verdicts", []),
    }


@router.patch("/prompt")
async def update_prompt(
    body: PromptPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if not body.system_prompt.strip():
        raise HTTPException(status_code=400, detail="System prompt cannot be empty")

    value_json = json.dumps(body.system_prompt)
    result = await db.execute(select(ConfigEntry).where(ConfigEntry.key == "system_prompt"))
    entry = result.scalar_one_or_none()
    if entry:
        entry.value = value_json
        entry.updated_at = datetime.utcnow()
    else:
        db.add(ConfigEntry(key="system_prompt", value=value_json))

    await db.commit()
    runtime_config.set("system_prompt", body.system_prompt)
    return {"message": "System prompt updated"}


@router.post("/reset")
async def reset_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Delete all runtime config from DB (reverts to defaults on next restart)."""
    result = await db.execute(select(ConfigEntry))
    entries = result.scalars().all()
    for e in entries:
        await db.delete(e)
    await db.commit()
    return {"message": f"Deleted {len(entries)} config entries. Defaults will apply on restart."}
