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
from typing import Any, Dict, Optional

from api.auth import get_current_user
from config import get_settings, runtime_config, compile_system_prompt, _DEFAULT_SYSTEM_PROMPT_BASE
from database import get_db
from models import ConfigEntry, User

router = APIRouter(prefix="/api/config", tags=["config"])


class ConfigPatch(BaseModel):
    updates: Dict[str, Any]


class PromptPatch(BaseModel):
    system_prompt: Optional[str] = None
    system_prompt_base: Optional[str] = None
    fraud_categories: Optional[list] = None


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
    updates = dict(body.updates)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    # If categories or prompt base are being updated, recompile the system prompt
    if "fraud_categories" in updates or "system_prompt_base" in updates:
        current_base = updates.get("system_prompt_base", runtime_config.get("system_prompt_base", _DEFAULT_SYSTEM_PROMPT_BASE))
        current_categories = updates.get("fraud_categories", runtime_config.get("fraud_categories", []))
        updates["system_prompt"] = compile_system_prompt(current_base, current_categories)

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

    # Trigger dynamic hot reload in running orchestrator
    try:
        from main import get_orchestrator
        orchestrator = get_orchestrator()
        if orchestrator:
            orchestrator.reload_config()
    except Exception as e:
        pass

    return {"message": "Config updated", "keys": list(updates.keys())}


@router.get("/prompt")
async def get_prompt(
    _: User = Depends(get_current_user),
):
    return {
        "system_prompt": runtime_config.get("system_prompt", ""),
        "system_prompt_base": runtime_config.get("system_prompt_base", _DEFAULT_SYSTEM_PROMPT_BASE),
        "fraud_categories": runtime_config.get("fraud_categories", []),
        "alert_verdicts": runtime_config.get("alert_verdicts", []),
    }


@router.patch("/prompt")
async def update_prompt(
    body: PromptPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    current_base = runtime_config.get("system_prompt_base", _DEFAULT_SYSTEM_PROMPT_BASE)
    current_categories = runtime_config.get("fraud_categories", [])

    updates = {}
    if body.system_prompt_base is not None:
        updates["system_prompt_base"] = body.system_prompt_base
        current_base = body.system_prompt_base
    if body.fraud_categories is not None:
        updates["fraud_categories"] = body.fraud_categories
        current_categories = body.fraud_categories

    # Check if we got an explicit full system prompt update (backwards compatibility)
    if body.system_prompt is not None and body.system_prompt.strip():
        updates["system_prompt"] = body.system_prompt
    else:
        updates["system_prompt"] = compile_system_prompt(current_base, current_categories)

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
    runtime_config.update(updates)

    # Trigger dynamic hot reload in running orchestrator
    try:
        from main import get_orchestrator
        orchestrator = get_orchestrator()
        if orchestrator:
            orchestrator.reload_config()
    except Exception as e:
        pass

    return {
        "message": "Prompt and categories updated",
        "system_prompt": runtime_config.get("system_prompt", "")
    }


@router.post("/reset")
async def reset_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Delete all runtime config from DB and reset cache (reverts to defaults)."""
    result = await db.execute(select(ConfigEntry))
    entries = result.scalars().all()
    for e in entries:
        await db.delete(e)
    await db.commit()

    # Reset cache in memory
    runtime_config.reset()

    # Trigger dynamic hot reload in running orchestrator to apply defaults immediately
    try:
        from main import get_orchestrator
        orchestrator = get_orchestrator()
        if orchestrator:
            orchestrator.reload_config()
    except Exception as e:
        pass

    return {"message": f"Deleted {len(entries)} config entries. Defaults applied immediately."}
