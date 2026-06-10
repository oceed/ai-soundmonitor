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
        vad_use_silero: bool = False,
        vad_auto_calibrate: bool = True,
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
        self._vad_use_silero = vad_use_silero
        self._vad_auto_calibrate = vad_auto_calibrate

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stream = None
        self._pa = None
        self._actual_device_name = ""
        self._lock = threading.Lock()

        # Calibration state
        self._calibrating = vad_auto_calibrate and not vad_use_silero
        self._calibration_rms: List[float] = []
        self._calibration_limit = int(2.0 * (sample_rate / chunk_size))

        # Initialize VAD engine
        from pipeline.vad import create_vad
        self._vad = create_vad(use_silero=vad_use_silero, threshold=vad_threshold)

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
        use_silero: Optional[bool] = None,
        auto_calibrate: Optional[bool] = None,
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
            if use_silero is not None:
                self._vad_use_silero = use_silero
            if auto_calibrate is not None:
                self._vad_auto_calibrate = auto_calibrate

            # Recreate VAD if threshold or use_silero changes
            if threshold is not None or use_silero is not None:
                from pipeline.vad import create_vad
                self._vad = create_vad(use_silero=self._vad_use_silero, threshold=self._vad_threshold)

            # Trigger calibration if auto_calibrate turned on and not using Silero
            if auto_calibrate is not None and auto_calibrate and not self._vad_use_silero:
                self._calibrating = True
                self._calibration_rms = []

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
            n = pa.get_device_count()
            for i in range(n):
                dev = pa.get_device_info_by_index(i)
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
            try:
                dev = pa.get_device_info_by_index(idx)
                self._actual_device_name = dev.get("name", f"Device {idx}")
                return idx
            except Exception as e:
                logger.warning(f"[Capture] Failed to get device info for index {idx}: {e}. Falling back to auto-detect.")

        # Auto: prefer USB/OBSBOT mic
        n = pa.get_device_count()
        # 1. Search for OBSBOT or other USB input devices
        for i in range(n):
            try:
                dev = pa.get_device_info_by_index(i)
                if dev.get("maxInputChannels", 0) > 0:
                    name = dev.get("name", "").lower()
                    if any(k in name for k in ["usb", "cam", "webcam", "uvc", "obsbot"]):
                        self._actual_device_name = dev.get("name", f"Device {i}")
                        logger.info(f"[Capture] Auto-selected USB device: {self._actual_device_name} [{i}]")
                        return i
            except Exception:
                continue

        # 2. Search for any other available input device
        for i in range(n):
            try:
                dev = pa.get_device_info_by_index(i)
                if dev.get("maxInputChannels", 0) > 0:
                    self._actual_device_name = dev.get("name", f"Device {i}")
                    logger.info(f"[Capture] Auto-selected device: {self._actual_device_name} [{i}]")
                    return i
            except Exception:
                continue

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

        # Determine the supported sample rate
        supported_rates = [self._sample_rate, 44100, 48000, 32000, 8000]
        device_rate = self._sample_rate

        try:
            if device_index is None or device_index < 0:
                dev_info = pa.get_default_input_device_info()
            else:
                dev_info = pa.get_device_info_by_index(device_index)
            
            default_rate = int(dev_info.get("defaultSampleRate", 0))
            if default_rate > 0 and default_rate not in supported_rates:
                supported_rates.insert(1, default_rate)
        except Exception as e:
            logger.warning(f"[Capture] Failed to query device default rate: {e}")

        # Find first rate that is supported
        for rate in supported_rates:
            try:
                if pa.is_format_supported(
                    rate=rate,
                    input_device=device_index,
                    input_channels=self._channels,
                    input_format=pyaudio.paInt16
                ):
                    device_rate = rate
                    break
            except Exception:
                continue
        else:
            logger.warning(f"[Capture] Could not confirm rate support, attempting default rate from device")
            try:
                if device_index is None or device_index < 0:
                    dev_info = pa.get_default_input_device_info()
                else:
                    dev_info = pa.get_device_info_by_index(device_index)
                device_rate = int(dev_info.get("defaultSampleRate", 16000))
            except Exception:
                device_rate = self._sample_rate

        # Configure chunk sizes
        device_chunk_size = self._chunk_size
        needs_resampling = False
        if device_rate != self._sample_rate:
            device_chunk_size = int(round(self._chunk_size * (device_rate / self._sample_rate)))
            needs_resampling = True
            logger.info(f"[Capture] Resampling enabled: mic rate {device_rate} Hz -> target {self._sample_rate} Hz (chunk: {device_chunk_size} -> {self._chunk_size})")

        try:
            stream = pa.open(
                format=pyaudio.paInt16,
                channels=self._channels,
                rate=device_rate,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=device_chunk_size,
            )
        except Exception as e:
            logger.error(f"[Capture] Cannot open audio stream at {device_rate} Hz: {e}")
            pa.terminate()
            return

        logger.info(f"[Capture] Microphone open: {self._actual_device_name} (rate: {device_rate} Hz)")

        fps = self._sample_rate // self._chunk_size
        speech_frames: List[bytes] = []
        silence_frames = 0
        consecutive_speech_frames = 0
        is_recording = False
        last_vad_state = "silence"

        try:
            while self._running:
                with self._lock:
                    threshold = self._vad_threshold
                    silence_limit = int(self._silence_duration * fps)
                    min_frames = int(self._min_speech_duration * fps)
                    max_frames = int(self._max_segment_duration * fps)
                    vad = self._vad
                    calibrating = self._calibrating
                    calibration_limit = self._calibration_limit

                data = stream.read(device_chunk_size, exception_on_overflow=False)
                ts = time.monotonic()

                # Resample to 16000 Hz if needed
                if needs_resampling and data:
                    try:
                        shorts = np.frombuffer(data, dtype=np.int16)
                        if len(shorts) > 1:
                            x_old = np.linspace(0, len(shorts) - 1, num=len(shorts))
                            x_new = np.linspace(0, len(shorts) - 1, num=self._chunk_size)
                            resampled_shorts = np.interp(x_new, x_old, shorts).astype(np.int16)
                            data = resampled_shorts.tobytes()
                    except Exception as re:
                        logger.error(f"[Capture] Resampling error: {re}")

                # Feed ring buffer
                self._ring_push(data, ts)

                rms = self._get_rms(data)
                if self._rms_cb:
                    self._rms_cb(rms)

                # VAD threshold auto-calibration
                if calibrating:
                    with self._lock:
                        self._calibration_rms.append(rms)
                        if len(self._calibration_rms) >= calibration_limit:
                            self._calibrating = False
                            avg_noise = float(np.mean(self._calibration_rms))
                            # Set threshold to avg_noise * 1.5 + 80, but at least 150
                            self._vad_threshold = max(150.0, avg_noise * 1.5 + 80.0)
                            from pipeline.vad import create_vad
                            self._vad = create_vad(use_silero=self._vad_use_silero, threshold=self._vad_threshold)
                            logger.info(f"[Capture] Auto-calibrated EnergyVAD threshold to {self._vad_threshold:.1f} (noise floor: {avg_noise:.1f})")
                            if self._vad_state_cb:
                                self._vad_state_cb("calibrated", self._vad_threshold)
                    continue

                is_speech = vad.is_speech(data)

                if is_speech:
                    consecutive_speech_frames += 1
                    if not is_recording:
                        # Require at least 2 consecutive speech frames (approx 64ms) to debounce noise spikes
                        if consecutive_speech_frames >= 2:
                            is_recording = True
                            speech_frames = [data]
                            silence_frames = 0
                            logger.debug("[VAD] Speech started")
                    else:
                        speech_frames.append(data)
                        silence_frames = 0
                else:
                    consecutive_speech_frames = 0
                    if is_recording:
                        silence_frames += 1
                        speech_frames.append(data)
                        if silence_frames >= silence_limit:
                            self._flush_segment(speech_frames, fps, min_frames, "silence")
                            speech_frames = []
                            silence_frames = 0
                            is_recording = False

                # Max segment length
                if is_recording and len(speech_frames) >= max_frames:
                    self._flush_segment(speech_frames, fps, min_frames, "maxlen")
                    speech_frames = []
                    silence_frames = 0
                    is_recording = False

                # Smoothed VAD state for the UI is tied to whether we are actively recording a segment
                vad_state = "speech" if is_recording else "silence"

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
