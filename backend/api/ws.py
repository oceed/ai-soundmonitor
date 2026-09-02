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
# Audio Listener Manager — relays live PCM to browser listeners
# ─────────────────────────────────────────────────────────

class AudioListenerManager:
    """
    Manages browser WebSocket listeners per counter_id.
    The orchestrator's AudioCapture pushes PCM chunks directly
    into this manager via push_chunk(); they are relayed to all
    connected browser WebSocket clients in real-time.
    """

    def __init__(self):
        self._listeners: dict[str, set] = {}   # counter_id → set of WebSocket
        self._lock = asyncio.Lock()

    async def add(self, counter_id: str, ws: WebSocket) -> None:
        async with self._lock:
            if counter_id not in self._listeners:
                self._listeners[counter_id] = set()
            self._listeners[counter_id].add(ws)
        logger.debug(f"[AudioListener] +1 listener for '{counter_id}'. Total: {len(self._listeners.get(counter_id, set()))}")

    async def remove(self, counter_id: str, ws: WebSocket) -> None:
        async with self._lock:
            listeners = self._listeners.get(counter_id, set())
            listeners.discard(ws)
            if not listeners:
                self._listeners.pop(counter_id, None)
        logger.debug(f"[AudioListener] -1 listener for '{counter_id}'")

    def has_listeners(self, counter_id: str) -> bool:
        return bool(self._listeners.get(counter_id))

    async def broadcast_chunk(self, counter_id: str, pcm: bytes) -> None:
        """Called from the pipeline (sync thread) via asyncio.run_coroutine_threadsafe."""
        async with self._lock:
            listeners = set(self._listeners.get(counter_id, set()))
        if not listeners:
            return
        dead = set()
        for ws in listeners:
            try:
                await ws.send_bytes(pcm)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._listeners.get(counter_id, set()).discard(ws)


# Singletons
audio_listener_manager = AudioListenerManager()


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
        from main import get_orchestrator, get_orchestrators  # avoid circular import
        orch_map = get_orchestrators()
        status_map = {}
        for c_id, orch in orch_map.items():
            status_map[c_id] = {
                "id": c_id,
                "running": orch.is_running,
                "stats": orch.stats
            }
        orch = get_orchestrator()
        await websocket.send_json({
            "type": "pipeline_status",
            "running": any(o.is_running for o in orch_map.values()),
            "stats": orch.stats if orch else {},
            "counters": status_map,
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
# Audio Listen Endpoint — relay local mic PCM to browser
# ─────────────────────────────────────────────────────────

@router.websocket("/ws/audio-listen/{counter_id}")
async def audio_listen_endpoint(
    websocket: WebSocket,
    counter_id: str,
    token: str = Query(..., description="JWT access token"),
):
    """
    Browser connects here to receive live PCM audio from a counter microphone.

    Binary frames: raw PCM 16kHz 16-bit signed integer mono (same as pipeline format).
    Decode client-side via Web Audio API (Int16Array → Float32 → AudioBuffer).

    Flow:
      AudioCapture._on_audio_chunk()
        → orchestrator._on_audio_chunk()
          → audio_listener_manager.broadcast_chunk()   ← injected from orchestrator
            → this WebSocket → browser AudioContext
    """
    # Validate JWT
    async with AsyncSessionLocal() as db:
        user = await validate_ws_token(token, db)

    if user is None:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()
    await audio_listener_manager.add(counter_id, websocket)
    logger.info(f"[AudioListen] Browser connected to counter '{counter_id}' (user: {user.username})")

    try:
        # Keep the WS alive; client sends nothing, just receives binary PCM
        while True:
            try:
                # Heartbeat: wait for any text (ping) from client; timeout = keepalive
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except Exception:
                    pass
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "heartbeat"})
            except (WebSocketDisconnect, Exception):
                break
    finally:
        await audio_listener_manager.remove(counter_id, websocket)
        logger.info(f"[AudioListen] Browser disconnected from counter '{counter_id}'")


# ─────────────────────────────────────────────────────────
# RMS Push Task (periodically broadcasts audio level)
# ─────────────────────────────────────────────────────────

async def rms_broadcast_task():
    """Background task: broadcast RMS every 100ms for live waveform."""
    while True:
        await asyncio.sleep(0.1)
        if ws_manager.client_count == 0:
            continue
        from main import get_orchestrators
        orch_map = get_orchestrators()
        for c_id, orch in orch_map.items():
            if orch and orch.is_running:
                stats = orch.stats
                await ws_manager.broadcast({
                    "type": "audio_level",
                    "counter_id": c_id,
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
            from main import get_orchestrators
            orch_map = get_orchestrators()
            for c_id, orch in orch_map.items():
                if orch and orch.is_running:
                    logger.info(f"[DeviceWatcher] Device change detected, triggering audio capture reload for counter {c_id}...")
                    await loop.run_in_executor(None, orch.reload_config, True)
        except Exception as e:
            logger.warning("[DeviceWatcher] Failed to trigger orchestrator capture reload: %s", e)
