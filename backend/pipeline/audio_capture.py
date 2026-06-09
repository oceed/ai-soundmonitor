"""
audio_capture.py — Microphone capture using PyAudio + ALSA.

Runs in a dedicated thread. Feeds raw PCM chunks to:
  - RingBuffer (for recording pre-buffer)
  - VAD (to detect speech segments)
  - Queue (for STT processing)

Emits RMS values for live waveform visualizer via callback.
"""

from __future__ import annotations

import logging
import queue
import struct
import threading
import time
from typing import Callable, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class AudioCapture:
    """
    Continuous microphone capture with VAD-driven segmentation.

    Thread model:
      - _capture_thread: reads from PyAudio stream, updates ring, runs VAD
      - segment_queue: populated when a speech segment is complete
    """

    def __init__(
        self,
        segment_queue: queue.Queue,
        ring_push_callback: Callable[[bytes, float], None],
        rms_callback: Optional[Callable[[float], None]] = None,
        vad_state_callback: Optional[Callable[[str, float], None]] = None,
        device_index: int = -1,
        sample_rate: int = 16000,
        channels: int = 1,
        chunk_size: int = 512,
        vad_threshold: float = 300.0,
        silence_duration: float = 1.5,
        min_speech_duration: float = 0.5,
        max_segment_duration: float = 15.0,
    ):
        self._segment_queue = segment_queue
        self._ring_push = ring_push_callback
        self._rms_cb = rms_callback
        self._vad_state_cb = vad_state_callback

        self._device_index = device_index
        self._sample_rate = sample_rate
        self._channels = channels
        self._chunk_size = chunk_size

        # VAD params (can be updated at runtime)
        self._vad_threshold = vad_threshold
        self._silence_duration = silence_duration
        self._min_speech_duration = min_speech_duration
        self._max_segment_duration = max_segment_duration

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stream = None
        self._pa = None
        self._actual_device_name = ""
        self._lock = threading.Lock()

    # ──────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._capture_loop,
            name="audio-capture",
            daemon=True,
        )
        self._thread.start()
        logger.info("[Capture] Audio capture thread started")

    def stop(self, timeout: float = 3.0) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=timeout)
        logger.info("[Capture] Audio capture thread stopped")

    def update_vad_params(
        self,
        threshold: Optional[float] = None,
        silence_duration: Optional[float] = None,
        min_speech_duration: Optional[float] = None,
        max_segment_duration: Optional[float] = None,
    ) -> None:
        with self._lock:
            if threshold is not None:
                self._vad_threshold = threshold
            if silence_duration is not None:
                self._silence_duration = silence_duration
            if min_speech_duration is not None:
                self._min_speech_duration = min_speech_duration
            if max_segment_duration is not None:
                self._max_segment_duration = max_segment_duration

    @property
    def device_name(self) -> str:
        return self._actual_device_name

    @staticmethod
    def list_devices() -> List[dict]:
        """List all available audio input devices."""
        try:
            import pyaudio
            pa = pyaudio.PyAudio()
            devices = []
            host_info = pa.get_host_api_info_by_index(0)
            n = host_info.get("deviceCount", 0)
            for i in range(n):
                dev = pa.get_device_info_by_host_api_device_index(0, i)
                if dev.get("maxInputChannels", 0) > 0:
                    devices.append({
                        "index": i,
                        "name": dev.get("name", f"Device {i}"),
                        "max_input_channels": dev.get("maxInputChannels"),
                        "default_sample_rate": int(dev.get("defaultSampleRate", 44100)),
                    })
            pa.terminate()
            return devices
        except Exception as e:
            logger.error(f"[Capture] list_devices error: {e}")
            return []

    # ──────────────────────────────────────────────────────
    # Internal
    # ──────────────────────────────────────────────────────

    def _get_rms(self, data: bytes) -> float:
        n = len(data) // 2
        if n == 0:
            return 0.0
        shorts = struct.unpack(f"{n}h", data[:n * 2])
        arr = np.array(shorts, dtype=np.float32)
        return float(np.sqrt(np.mean(arr ** 2)))

    def _resolve_device_index(self, pa) -> Optional[int]:
        """Auto-detect best mic if device_index == -1."""
        with self._lock:
            idx = self._device_index

        if idx >= 0:
            dev = pa.get_device_info_by_index(idx)
            self._actual_device_name = dev.get("name", f"Device {idx}")
            return idx

        # Auto: prefer USB mic
        host_info = pa.get_host_api_info_by_index(0)
        n = host_info.get("deviceCount", 0)
        for i in range(n):
            dev = pa.get_device_info_by_host_api_device_index(0, i)
            if dev.get("maxInputChannels", 0) > 0:
                name = dev.get("name", "").lower()
                if any(k in name for k in ["usb", "cam", "webcam", "uvc"]):
                    self._actual_device_name = dev.get("name", f"Device {i}")
                    logger.info(f"[Capture] Auto-selected USB device: {self._actual_device_name} [{i}]")
                    return i

        # Fallback: default device
        self._actual_device_name = "Default Microphone"
        return None

    def _capture_loop(self) -> None:
        try:
            import pyaudio
        except ImportError:
            logger.error("[Capture] pyaudio not installed!")
            return

        pa = pyaudio.PyAudio()
        device_index = self._resolve_device_index(pa)

        try:
            stream = pa.open(
                format=pyaudio.paInt16,
                channels=self._channels,
                rate=self._sample_rate,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=self._chunk_size,
            )
        except Exception as e:
            logger.error(f"[Capture] Cannot open audio stream: {e}")
            pa.terminate()
            return

        logger.info(f"[Capture] Microphone open: {self._actual_device_name}")

        fps = self._sample_rate // self._chunk_size
        speech_frames: List[bytes] = []
        silence_frames = 0
        is_recording = False
        last_vad_state = "silence"

        try:
            while self._running:
                with self._lock:
                    threshold = self._vad_threshold
                    silence_limit = int(self._silence_duration * fps)
                    min_frames = int(self._min_speech_duration * fps)
                    max_frames = int(self._max_segment_duration * fps)

                data = stream.read(self._chunk_size, exception_on_overflow=False)
                ts = time.monotonic()

                # Feed ring buffer
                self._ring_push(data, ts)

                rms = self._get_rms(data)
                if self._rms_cb:
                    self._rms_cb(rms)

                is_speech = rms > threshold

                if is_speech:
                    vad_state = "speech"
                    if not is_recording:
                        is_recording = True
                        speech_frames = []
                        silence_frames = 0
                        logger.debug("[VAD] Speech started")
                    speech_frames.append(data)
                    silence_frames = 0
                else:
                    if is_recording:
                        silence_frames += 1
                        speech_frames.append(data)
                        if silence_frames >= silence_limit:
                            self._flush_segment(speech_frames, fps, min_frames, "silence")
                            speech_frames = []
                            silence_frames = 0
                            is_recording = False
                    vad_state = "silence"

                # Max segment length
                if is_recording and len(speech_frames) >= max_frames:
                    self._flush_segment(speech_frames, fps, min_frames, "maxlen")
                    speech_frames = []
                    silence_frames = 0
                    is_recording = False
                    vad_state = "silence"

                if vad_state != last_vad_state and self._vad_state_cb:
                    self._vad_state_cb(vad_state, rms)
                    last_vad_state = vad_state

        except Exception as e:
            logger.error(f"[Capture] Capture loop error: {e}")
        finally:
            stream.stop_stream()
            stream.close()
            pa.terminate()
            logger.info("[Capture] Audio stream closed")

    def _flush_segment(
        self,
        frames: List[bytes],
        fps: int,
        min_frames: int,
        reason: str,
    ) -> None:
        duration = len(frames) / fps
        if len(frames) < min_frames:
            logger.debug(f"[VAD] Segment too short ({duration:.1f}s), discarding")
            return

        pcm = b"".join(frames)
        self._segment_queue.put({
            "pcm": pcm,
            "timestamp": time.time(),
            "duration_s": duration,
            "reason": reason,
        })
        logger.debug(f"[VAD] Segment queued: {duration:.1f}s ({reason}), Q={self._segment_queue.qsize()}")
