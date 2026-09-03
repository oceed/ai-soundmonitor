"""
services/audio_stream_service.py — Outbound audio streaming to Cloud.

Pushes raw PCM chunks from the local pipeline to a Cloud WebSocket endpoint
so dashboard users can listen to counter audio in real-time.

Architecture:
  AudioCapture → side-tap callback → AudioStreamService.push_chunk()
    → per-counter asyncio queue → outbound WS to cloud
    → Cloud relays to browser listeners

Design principles:
  - Non-blocking: push_chunk() is always instant (drops oldest if queue full)
  - Auto-reconnect: exponential backoff on connection loss
  - Per-counter streams: each counter_id gets its own WS connection + queue
  - Graceful enable/disable: call start()/stop() at runtime
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
import time
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_RECONNECT_MIN = 2.0
_RECONNECT_MAX = 60.0
_CHUNK_QUEUE_MAXSIZE = 50   # ~5 seconds buffer at 100ms chunks


class CounterStream:
    """
    Manages the outbound WebSocket connection for one counter.
    Runs its own asyncio event loop on a daemon background thread.
    """

    def __init__(
        self,
        counter_id: str,
        cloud_url: str,
        device_token: str,
        device_id: str,
    ):
        self.counter_id = counter_id
        self.cloud_url = cloud_url
        self.device_token = device_token
        self.device_id = device_id

        self._chunk_queue: queue.Queue = queue.Queue(maxsize=_CHUNK_QUEUE_MAXSIZE)
        self._stop_event = threading.Event()
        self._connected = False
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_thread,
            name=f"audio-stream-{self.counter_id}",
            daemon=True,
        )
        self._thread.start()
        logger.info(f"[AudioStream/{self.counter_id}] Stream thread started → {self.cloud_url}")

    def stop(self) -> None:
        self._stop_event.set()
        # Unblock queue waiter
        try:
            self._chunk_queue.put_nowait(None)
        except queue.Full:
            pass
        if self._thread:
            self._thread.join(timeout=5)
        self._connected = False
        logger.info(f"[AudioStream/{self.counter_id}] Stream stopped")

    def push_chunk(self, pcm: bytes) -> None:
        """Non-blocking. Drops oldest chunk if queue is full (live stream, freshness > completeness)."""
        if self._stop_event.is_set():
            return
        if self._chunk_queue.full():
            try:
                self._chunk_queue.get_nowait()
            except queue.Empty:
                pass
        try:
            self._chunk_queue.put_nowait(pcm)
        except queue.Full:
            pass

    @property
    def is_connected(self) -> bool:
        return self._connected

    # ──────────────────────────────────────────────────────
    # Background thread
    # ──────────────────────────────────────────────────────

    def _run_thread(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._run_async())
        except Exception as e:
            logger.error(f"[AudioStream/{self.counter_id}] Fatal thread error: {e}")
        finally:
            loop.close()

    async def _run_async(self) -> None:
        delay = _RECONNECT_MIN
        while not self._stop_event.is_set():
            was_connected = False
            try:
                await self._stream_loop()
                delay = _RECONNECT_MIN  # reset on clean exit
            except Exception as e:
                was_connected = self._connected
                self._connected = False
                if not self._stop_event.is_set():
                    # If we were previously connected, attempt quick reconnect (2s)
                    if was_connected:
                        delay = _RECONNECT_MIN
                    logger.warning(
                        f"[AudioStream/{self.counter_id}] Connection error: {e}. "
                        f"Reconnecting in {delay:.0f}s…"
                    )
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, _RECONNECT_MAX)

    async def _stream_loop(self) -> None:
        try:
            import websockets
        except ImportError:
            logger.error(
                f"[AudioStream/{self.counter_id}] 'websockets' package not installed. "
                "Run: pip install websockets"
            )
            # Don't reconnect rapidly on import error — wait max delay
            await asyncio.sleep(_RECONNECT_MAX)
            return

        # Build target URL with auth params
        url = (
            f"{self.cloud_url.rstrip('/')}/"
            f"{self.device_id}/{self.counter_id}"
            f"?token={self.device_token}"
        )

        logger.info(f"[AudioStream/{self.counter_id}] Connecting to {self.cloud_url}/…")

        async with websockets.connect(
            url,
            ping_interval=None,  # Continuous binary push; send() errors catch broken socket directly
            close_timeout=5,
        ) as ws:
            self._connected = True
            logger.info(f"[AudioStream/{self.counter_id}] ✓ Connected to cloud streaming endpoint")

            while not self._stop_event.is_set():
                # Drain the queue and send chunks
                try:
                    # Block briefly to avoid busy-loop; non-blocking get with small timeout
                    chunk = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: self._chunk_queue.get(timeout=0.5)
                    )
                except queue.Empty:
                    continue

                if chunk is None:
                    # Sentinel → stop requested
                    break

                try:
                    await ws.send(chunk)
                except Exception as send_err:
                    logger.warning(f"[AudioStream/{self.counter_id}] Send error: {send_err}")
                    raise  # re-raise to trigger reconnect

        self._connected = False


class AudioStreamService:
    """
    Central service managing outbound audio WebSocket streams for all counters.
    One CounterStream instance per counter that is actively streaming.

    Usage:
        svc = AudioStreamService(runtime_config)
        svc.start(loop)
        svc.push_chunk("counter_1", pcm_bytes)   # called from AudioCapture callback
        svc.stop()
    """

    def __init__(self, runtime_config):
        self._rc = runtime_config
        self._streams: Dict[str, CounterStream] = {}
        self._lock = threading.Lock()

    def start(self, counter_ids: list[str]) -> None:
        """Start streaming for each counter_id. Called when pipeline starts."""
        if not self._rc.get("audio_stream_enabled", False):
            logger.info("[AudioStreamService] Disabled via config — skipping start")
            return

        cloud_url = self._rc.get("audio_stream_cloud_url", "").strip()
        device_token = self._rc.get("audio_stream_device_token", "").strip()
        device_id = self._rc.get("device_id", "edge-device-01")

        if not cloud_url:
            logger.warning("[AudioStreamService] audio_stream_cloud_url not configured")
            return

        with self._lock:
            for c_id in counter_ids:
                if c_id not in self._streams:
                    stream = CounterStream(
                        counter_id=c_id,
                        cloud_url=cloud_url,
                        device_token=device_token,
                        device_id=device_id,
                    )
                    stream.start()
                    self._streams[c_id] = stream

    def stop(self) -> None:
        """Stop all active streams."""
        with self._lock:
            for c_id, stream in list(self._streams.items()):
                stream.stop()
            self._streams.clear()
        logger.info("[AudioStreamService] All streams stopped")

    def stop_counter(self, counter_id: str) -> None:
        """Stop streaming for a specific counter."""
        with self._lock:
            stream = self._streams.pop(counter_id, None)
        if stream:
            stream.stop()

    def push_chunk(self, counter_id: str, pcm: bytes) -> None:
        """
        Called from AudioCapture callback (background thread).
        Non-blocking — drops oldest if queue is full.
        """
        with self._lock:
            stream = self._streams.get(counter_id)
        if stream:
            stream.push_chunk(pcm)

    def is_connected(self, counter_id: str) -> bool:
        with self._lock:
            stream = self._streams.get(counter_id)
        return stream.is_connected if stream else False

    def status(self) -> dict:
        """Return status dict for API/health endpoint."""
        with self._lock:
            return {
                "enabled": self._rc.get("audio_stream_enabled", False),
                "counters": {
                    c_id: {"connected": s.is_connected}
                    for c_id, s in self._streams.items()
                },
            }

    def reload_config(self, counter_ids: list[str]) -> None:
        """
        Called when settings change. Stops all streams and restarts if still enabled.
        """
        self.stop()
        self.start(counter_ids)
