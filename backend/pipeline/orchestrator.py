"""
orchestrator.py — Pipeline coordinator.

Manages the lifecycle of all pipeline threads:
  AudioCapture → STT Worker → LLM Worker → Result Handler

Integrates with:
  - WebSocket broadcast
  - DB writes (via sync SQLAlchemy for thread compatibility)
  - Recorder (pre/post buffer)
  - MQTT service
  - Audio upload service
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────
# Orchestrator
# ─────────────────────────────────────────────────────────

class PipelineOrchestrator:
    """
    Central coordinator for the fraud detection pipeline.
    All state is accessible via properties for the API layer.
    """

    def __init__(self, settings, runtime_config, broadcast_fn: Callable, db_writer):
        self._settings = settings
        self._rc = runtime_config          # RuntimeConfig instance
        self._broadcast = broadcast_fn     # async broadcast to WebSocket clients
        self._db = db_writer               # DBWriter (sync wrapper)

        self._segment_queue: queue.Queue = queue.Queue(maxsize=20)
        self._running = False
        self._session_id: Optional[int] = None

        # Pipeline components (initialized on start)
        self._capture = None
        self._recorder = None
        self._stt = None
        self._llm = None
        self._mqtt = None
        self._audio_uploader = None

        # Worker threads
        self._stt_thread: Optional[threading.Thread] = None
        self._llm_queue: queue.Queue = queue.Queue(maxsize=10)
        self._llm_thread: Optional[threading.Thread] = None

        # Stats
        self._stats = {"FRAUD": 0, "SUSPICIOUS": 0, "NORMAL": 0, "ERROR": 0}
        self._segment_counter = 0
        self._current_rms = 0.0
        self._vad_state = "silence"
        self._lock = threading.Lock()

        # Event loop reference (set when start() is called from async context)
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ──────────────────────────────────────────────────────
    # Lifecycle
    # ──────────────────────────────────────────────────────

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        if self._running:
            logger.warning("[Orchestrator] Already running")
            return

        self._loop = loop
        self._running = True
        self._stats = {"FRAUD": 0, "SUSPICIOUS": 0, "NORMAL": 0, "ERROR": 0}
        self._segment_counter = 0

        # Initialize components
        self._init_stt()
        self._init_llm()
        self._init_recorder()
        self._init_mqtt()
        self._init_audio_uploader()

        # Create DB session
        self._session_id = self._db.create_session(
            device_name=self._rc.get("device_name", "unknown"),
            audio_device_index=self._rc.get("audio_device_index", -1),
            stt_mode=self._rc.get("stt_mode", "auto"),
            llm_mode=self._rc.get("llm_mode", "auto"),
        )
        logger.info(f"[Orchestrator] Session {self._session_id} created")

        # Start workers
        self._stt_thread = threading.Thread(
            target=self._stt_worker, name="stt-worker", daemon=True
        )
        self._llm_thread = threading.Thread(
            target=self._llm_worker, name="llm-worker", daemon=True
        )
        self._stt_thread.start()
        self._llm_thread.start()

        # Start audio capture
        self._init_capture()
        self._capture.start()

        logger.info("[Orchestrator] Pipeline started")
        self._emit("pipeline_status", {
            "running": True,
            "stt_mode": self._rc.get("stt_mode", "auto"),
            "llm_mode": self._rc.get("llm_mode", "auto"),
            "device_name": self._rc.get("device_name", ""),
            "session_id": self._session_id,
        })

    def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        logger.info("[Orchestrator] Stopping pipeline...")

        if self._capture:
            self._capture.stop()

        # Signal worker threads
        self._segment_queue.put(None)
        self._llm_queue.put(None)

        if self._stt_thread:
            self._stt_thread.join(timeout=5)
        if self._llm_thread:
            self._llm_thread.join(timeout=self._settings.llm_timeout + 10)

        # Close session
        if self._session_id:
            self._db.close_session(self._session_id, self._stats)

        self._emit("pipeline_status", {"running": False, "session_id": self._session_id})
        logger.info("[Orchestrator] Pipeline stopped")

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                **self._stats,
                "session_id": self._session_id,
                "segments": self._segment_counter,
                "vad_state": self._vad_state,
                "rms": self._current_rms,
            }

    # ──────────────────────────────────────────────────────
    # Component Initialization
    # ──────────────────────────────────────────────────────

    def _init_stt(self) -> None:
        from pipeline.stt import STTEngine
        s = self._settings
        rc = self._rc
        self._stt = STTEngine(
            mode=rc.get("stt_mode", s.stt_mode),
            groq_api_key=s.groq_api_key,
            groq_model=s.groq_stt_model,
            local_model=rc.get("local_whisper_model", s.local_whisper_model),
            local_device=s.local_whisper_device,
            local_compute_type=s.local_whisper_compute_type,
            timeout=s.stt_timeout,
        )

    def _init_llm(self) -> None:
        from pipeline.llm import LLMEngine
        s = self._settings
        rc = self._rc
        self._llm = LLMEngine(
            mode=rc.get("llm_mode", s.llm_mode),
            groq_api_key=s.groq_api_key,
            groq_model=s.groq_llm_model,
            local_url=rc.get("local_llm_url", s.local_llm_url),
            local_model=rc.get("local_llm_model", s.local_llm_model),
            local_endpoint_type=rc.get("local_llm_endpoint_type", s.local_llm_endpoint_type),
            timeout=s.llm_timeout,
        )

    def _init_recorder(self) -> None:
        from pipeline.recorder import Recorder
        s = self._settings
        rc = self._rc
        recordings_dir = Path(s.storage_path) / "recordings"
        self._recorder = Recorder(
            recordings_dir=recordings_dir,
            pre_buffer_s=rc.get("pre_buffer_seconds", s.pre_buffer_seconds),
            post_buffer_s=rc.get("post_buffer_seconds", s.post_buffer_seconds),
            recording_format=s.recording_format,
            sample_rate=s.sample_rate,
            channels=s.channels,
        )

    def _init_capture(self) -> None:
        from pipeline.audio_capture import AudioCapture
        s = self._settings
        rc = self._rc
        self._capture = AudioCapture(
            segment_queue=self._segment_queue,
            ring_push_callback=self._on_ring_push,
            rms_callback=self._on_rms,
            vad_state_callback=self._on_vad_state,
            device_index=rc.get("audio_device_index", s.audio_device_index),
            sample_rate=s.sample_rate,
            channels=s.channels,
            chunk_size=s.chunk_size,
            vad_threshold=rc.get("vad_threshold", s.vad_threshold),
            silence_duration=rc.get("vad_silence_duration", s.vad_silence_duration),
            min_speech_duration=rc.get("vad_min_speech_duration", s.vad_min_speech_duration),
            max_segment_duration=rc.get("vad_max_segment_duration", s.vad_max_segment_duration),
        )

    def _init_mqtt(self) -> None:
        if not self._rc.get("mqtt_enabled", False):
            return
        try:
            from services.mqtt_service import MQTTService
            self._mqtt = MQTTService(self._rc)
            self._mqtt.connect()
        except Exception as e:
            logger.error(f"[Orchestrator] MQTT init failed: {e}")

    def _init_audio_uploader(self) -> None:
        if not self._rc.get("audio_upload_enabled", False):
            return
        try:
            from services.audio_upload import AudioUploadService
            self._audio_uploader = AudioUploadService(self._rc)
        except Exception as e:
            logger.error(f"[Orchestrator] Audio uploader init failed: {e}")

    # ──────────────────────────────────────────────────────
    # Callbacks from AudioCapture
    # ──────────────────────────────────────────────────────

    def _on_ring_push(self, chunk: bytes, ts: float) -> None:
        if self._recorder:
            self._recorder.push_chunk(chunk, ts)

    def _on_rms(self, rms: float) -> None:
        with self._lock:
            self._current_rms = rms
        # Throttle: emit every ~100ms (not every chunk)
        # In practice, WebSocket will send at ~10Hz via periodic task

    def _on_vad_state(self, state: str, rms: float) -> None:
        with self._lock:
            self._vad_state = state
        self._emit("vad_state", {"state": state, "rms": round(rms, 1)})

    # ──────────────────────────────────────────────────────
    # STT Worker Thread
    # ──────────────────────────────────────────────────────

    def _stt_worker(self) -> None:
        logger.info("[STT Worker] Started")
        while self._running or not self._segment_queue.empty():
            try:
                item = self._segment_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            if item is None:
                break

            with self._lock:
                self._segment_counter += 1
                seg_no = self._segment_counter

            self._emit("stt_progress", {"segment_no": seg_no, "status": "transcribing"})
            result = self._stt.transcribe(
                item["pcm"],
                sample_rate=self._settings.sample_rate,
                channels=self._settings.channels,
            )

            if not result.text:
                logger.debug(f"[STT #{seg_no}] Empty transcript, skipping")
                self._segment_queue.task_done()
                continue

            self._emit("stt_progress", {
                "segment_no": seg_no,
                "status": "done",
                "text": result.text,
                "mode": result.mode_used,
                "elapsed_ms": result.elapsed_ms,
            })

            self._llm_queue.put({
                "seg_no": seg_no,
                "stt_result": result,
                "pcm": item["pcm"],
                "timestamp": datetime.fromtimestamp(item["timestamp"], tz=timezone.utc),
                "duration_s": item["duration_s"],
            })
            self._segment_queue.task_done()

        logger.info("[STT Worker] Stopped")

    # ──────────────────────────────────────────────────────
    # LLM Worker Thread
    # ──────────────────────────────────────────────────────

    def _llm_worker(self) -> None:
        logger.info("[LLM Worker] Started")
        while self._running or not self._llm_queue.empty():
            try:
                item = self._llm_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            if item is None:
                break

            seg_no = item["seg_no"]
            stt = item["stt_result"]
            timestamp = item["timestamp"]

            self._emit("llm_progress", {"segment_no": seg_no, "status": "analyzing"})
            system_prompt = self._rc.get("system_prompt", "")
            fraud_result = self._llm.analyze(stt.text, system_prompt)

            # Update stats
            with self._lock:
                verdict_key = fraud_result.verdict if fraud_result.verdict in self._stats else "ERROR"
                self._stats[verdict_key] = self._stats.get(verdict_key, 0) + 1

            # Persist to DB
            segment_id = self._db.save_segment(
                session_id=self._session_id,
                timestamp=timestamp,
                transcript=stt.text,
                duration_s=item["duration_s"],
                fraud_result=fraud_result,
                stt_ms=stt.elapsed_ms,
                llm_ms=fraud_result.elapsed_ms,
                stt_mode=stt.mode_used,
                llm_mode=fraud_result.mode_used,
            )

            # Broadcast result
            self._emit("segment_result", {
                "segment_no": seg_no,
                "segment_id": segment_id,
                "transcript": stt.text,
                "verdict": fraud_result.verdict,
                "classification": fraud_result.classification,
                "confidence": fraud_result.confidence,
                "risk_level": fraud_result.risk_level,
                "reason": fraud_result.reason,
                "flags": fraud_result.active_flags,
                "evidence": fraud_result.evidence,
                "stt_ms": stt.elapsed_ms,
                "llm_ms": fraud_result.elapsed_ms,
                "stt_mode": stt.mode_used,
                "llm_mode": fraud_result.mode_used,
                "timestamp": timestamp.isoformat(),
            })

            # Handle alert
            alert_verdicts = set(self._rc.get("alert_verdicts", []))
            if fraud_result.classification in alert_verdicts or fraud_result.is_alert:
                self._handle_alert(
                    segment_id=segment_id,
                    segment_no=seg_no,
                    timestamp=timestamp,
                    fraud_result=fraud_result,
                    stt=stt,
                    duration_s=item["duration_s"],
                )

            self._llm_queue.task_done()

        logger.info("[LLM Worker] Stopped")

    # ──────────────────────────────────────────────────────
    # Alert Handler
    # ──────────────────────────────────────────────────────

    def _handle_alert(self, segment_id, segment_no, timestamp, fraud_result, stt, duration_s) -> None:
        logger.info(
            f"[Alert] Segment #{segment_no}: {fraud_result.classification} "
            f"({fraud_result.confidence}%) — {fraud_result.reason[:60]}"
        )

        # Persist alert
        alert_id = self._db.save_alert(
            segment_id=segment_id,
            session_id=self._session_id,
            timestamp=timestamp,
            fraud_result=fraud_result,
            transcript=stt.text,
            pre_buffer_s=self._rc.get("pre_buffer_seconds", 10.0),
            post_buffer_s=self._rc.get("post_buffer_seconds", 15.0),
        )

        # Broadcast UI alert
        self._emit("alert", {
            "alert_id": alert_id,
            "segment_id": segment_id,
            "verdict": fraud_result.verdict,
            "classification": fraud_result.classification,
            "confidence": fraud_result.confidence,
            "risk_level": fraud_result.risk_level,
            "reason": fraud_result.reason,
            "flags": fraud_result.active_flags,
            "transcript": stt.text,
            "timestamp": timestamp.isoformat(),
            "has_recording": False,
        })

        # Trigger recording + MQTT in background thread
        threading.Thread(
            target=self._alert_postprocess,
            args=(alert_id, fraud_result, timestamp),
            daemon=True,
        ).start()

    def _alert_postprocess(self, alert_id: int, fraud_result, timestamp: datetime) -> None:
        """Handle recording + audio upload + MQTT in background."""
        # 1. Trigger recorder
        record_verdict = self._rc.get("record_on_verdict", "BOTH")
        should_record = (
            record_verdict == "BOTH"
            or (record_verdict == "FRAUD" and "FRAUD" in fraud_result.classification)
            or (record_verdict == "SUSPICIOUS" and fraud_result.classification == "SUSPICIOUS")
        )

        recording_info = None
        if should_record and self._recorder:
            self._recorder.start_alert_recording(
                alert_id=alert_id,
                verdict=fraud_result.classification,
                segment_timestamp=timestamp,
                pre_s=self._rc.get("pre_buffer_seconds", 10.0),
                post_s=self._rc.get("post_buffer_seconds", 15.0),
            )
            recording_info = self._recorder.wait_for_recording(
                alert_id, timeout=self._rc.get("post_buffer_seconds", 15.0) + 30
            )

        # 2. Update alert with recording path
        if recording_info:
            self._db.update_alert_recording(alert_id, recording_info)
            self._emit("alert_recording_ready", {
                "alert_id": alert_id,
                "has_recording": True,
                "duration_s": recording_info["duration_s"],
            })

        # 3. Upload audio & get unique ID
        audio_unique_id = None
        if self._rc.get("audio_upload_enabled", False) and self._audio_uploader and recording_info:
            try:
                audio_unique_id = self._audio_uploader.upload(recording_info["path"])
                if audio_unique_id:
                    self._db.update_alert_upload_id(alert_id, audio_unique_id)
                    logger.info(f"[Alert {alert_id}] Audio uploaded, id={audio_unique_id}")
            except Exception as e:
                logger.error(f"[Alert {alert_id}] Audio upload failed: {e}")

        # 4. Publish MQTT
        if self._rc.get("mqtt_enabled", False) and self._mqtt:
            try:
                alert_data = self._db.get_alert(alert_id)
                payload = {
                    "alert_id": alert_id,
                    "audio_unique_id": audio_unique_id or "",
                    "verdict": fraud_result.verdict,
                    "classification": fraud_result.classification,
                    "confidence": fraud_result.confidence,
                    "risk_level": fraud_result.risk_level,
                    "reason": fraud_result.reason,
                    "flags": fraud_result.active_flags,
                    "evidence": fraud_result.evidence,
                    "transcript": alert_data.get("transcript", "") if alert_data else "",
                    "timestamp": timestamp.isoformat(),
                    "device_name": self._rc.get("device_name", ""),
                    "session_id": self._session_id,
                }
                self._mqtt.publish(payload)
                self._db.mark_mqtt_sent(alert_id)
                logger.info(f"[Alert {alert_id}] Published to MQTT")
            except Exception as e:
                logger.error(f"[Alert {alert_id}] MQTT publish failed: {e}")

    # ──────────────────────────────────────────────────────
    # WebSocket Broadcast
    # ──────────────────────────────────────────────────────

    def _emit(self, event_type: str, data: Dict[str, Any]) -> None:
        if self._loop is None or not self._loop.is_running():
            return
        payload = {"type": event_type, **data}
        asyncio.run_coroutine_threadsafe(
            self._broadcast(payload),
            self._loop,
        )
