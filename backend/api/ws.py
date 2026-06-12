"""
ws.py — WebSocket endpoint for real-time event broadcasting.

Connection: ws://<host>:8001/ws?token=<jwt>
Messages: JSON objects with 'type' field (see ARCHITECTURE.md)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Set

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import validate_ws_token
from database import AsyncSessionLocal

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

# ─────────────────────────────────────────────────────────
# Connection Manager
# ─────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
        logger.debug(f"[WS] Client connected. Total: {len(self._connections)}")

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)
        logger.debug(f"[WS] Client disconnected. Total: {len(self._connections)}")

    async def broadcast(self, message: dict) -> None:
        if not self._connections:
            return
        payload = json.dumps(message, ensure_ascii=False, default=str)
        async with self._lock:
            dead = set()
            for ws in self._connections:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.add(ws)
            self._connections -= dead

    @property
    def client_count(self) -> int:
        return len(self._connections)


# Singleton
ws_manager = ConnectionManager()


# ─────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────

@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(..., description="JWT access token"),
):
    # Validate token
    async with AsyncSessionLocal() as db:
        user = await validate_ws_token(token, db)

    if user is None:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await ws_manager.connect(websocket)
    try:
        # Send welcome + current status
        from main import get_orchestrator  # avoid circular import
        orch = get_orchestrator()
        if orch:
            await websocket.send_json({
                "type": "pipeline_status",
                "running": orch.is_running,
                **orch.stats,
            })

        while True:
            # Keep alive — handle ping or client messages
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # Send periodic heartbeat
                await websocket.send_json({"type": "heartbeat"})
            except (WebSocketDisconnect, Exception):
                break

    finally:
        await ws_manager.disconnect(websocket)


# ─────────────────────────────────────────────────────────
# RMS Push Task (periodically broadcasts audio level)
# ─────────────────────────────────────────────────────────

async def rms_broadcast_task():
    """Background task: broadcast RMS every 100ms for live waveform."""
    while True:
        await asyncio.sleep(0.1)
        if ws_manager.client_count == 0:
            continue
        from main import get_orchestrator
        orch = get_orchestrator()
        if orch and orch.is_running:
            stats = orch.stats
            await ws_manager.broadcast({
                "type": "audio_level",
                "rms": stats.get("rms", 0.0),
                "vad_state": stats.get("vad_state", "silence"),
            })


async def device_watcher_task():
    """Background task: watch /dev/snd for USB hotplug events.

    Polls the device node list every 2 seconds. When it detects that
    audio devices have been added or removed (by comparing the set of
    files in /dev/snd), it re-enumerates all PyAudio input devices and
    broadcasts an 'audio_devices_changed' event to all WebSocket clients
    so the frontend dropdown auto-updates without any user action.
    """
    from pipeline.audio_capture import AudioCapture

    SND_DIR = "/dev/snd"
    prev_nodes: set = set()

    # Initialise with the current state so we don't fire on startup
    try:
        prev_nodes = set(os.listdir(SND_DIR))
    except OSError:
        pass

    logger.info("[DeviceWatcher] Started — monitoring %s for USB audio hotplug", SND_DIR)

    while True:
        await asyncio.sleep(2)

        if ws_manager.client_count == 0:
            continue

        try:
            current_nodes = set(os.listdir(SND_DIR))
        except OSError:
            current_nodes = set()

        if current_nodes == prev_nodes:
            continue

        added   = current_nodes - prev_nodes
        removed = prev_nodes    - current_nodes
        prev_nodes = current_nodes

        logger.info(
            "[DeviceWatcher] Audio device change detected — added: %s  removed: %s",
            added, removed,
        )

        # Re-enumerate PyAudio devices (runs in executor so it won't block the event loop)
        loop = asyncio.get_running_loop()
        try:
            devices = await loop.run_in_executor(None, AudioCapture.list_devices)
        except Exception as exc:
            logger.warning("[DeviceWatcher] list_devices failed: %s", exc)
            devices = []

        await ws_manager.broadcast({
            "type": "audio_devices_changed",
            "devices": devices,
            "added_nodes": list(added),
            "removed_nodes": list(removed),
        })

        # Trigger orchestrator capture reload (runs in executor to prevent event loop blocking)
        try:
            from main import get_orchestrator
            orch = get_orchestrator()
            if orch and orch.is_running:
                logger.info("[DeviceWatcher] Device change detected, triggering audio capture reload...")
                await loop.run_in_executor(None, orch.reload_config, True)
        except Exception as e:
            logger.warning("[DeviceWatcher] Failed to trigger orchestrator capture reload: %s", e)
