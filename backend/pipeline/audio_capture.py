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

    def _find_working_stream(self, pa) -> Tuple[Any, int, int, int, str]:
        """
        Attempts to open a working PyAudio stream.
        Tries the configured device index first (if >= 0).
        If that fails (or index is -1), tries other devices in priority order:
        1. OBSBOT devices
        2. Default device
        3. USB devices
        4. Other input devices
        
        Returns:
            Tuple of (stream, device_index, opened_rate, opened_channels, device_name)
            or (None, -1, 0, 0, "") if no device could be opened.
        """
        import pyaudio

        # 1. Determine target index from config
        with self._lock:
            config_idx = self._device_index

        # 2. Get default device index if possible
        default_idx = -1
        try:
            default_info = pa.get_default_input_device_info()
            default_idx = default_info.get("index", -1)
        except Exception:
            pass

        # 3. Build prioritized list of devices to try
        # Each item: (priority, index, name)
        device_candidates = []

        # If user explicitly chose a device, give it highest priority (e.g. 1000)
        if config_idx >= 0:
            try:
                dev_info = pa.get_device_info_by_index(config_idx)
                if dev_info.get("maxInputChannels", 0) > 0:
                    name = dev_info.get("name", f"Device {config_idx}")
                    device_candidates.append((1000, config_idx, name))
            except Exception:
                logger.warning(f"[Capture] Configured device index {config_idx} not found or invalid.")

        # Gather other devices
        n = pa.get_device_count()
        for i in range(n):
            # Skip if it is the configured index since we already added/tried it
            if i == config_idx:
                continue
            try:
                dev_info = pa.get_device_info_by_index(i)
                if dev_info.get("maxInputChannels", 0) <= 0:
                    continue
                name = dev_info.get("name", "").lower()

                # Assign priority
                if "obsbot" in name:
                    priority = 100
                elif i == default_idx:
                    priority = 80
                elif any(k in name for k in ["usb", "cam", "webcam", "uvc"]):
                    priority = 60
                else:
                    priority = 10

                device_candidates.append((priority, i, dev_info.get("name", f"Device {i}")))
            except Exception:
                continue

        # Sort candidates by priority descending
        device_candidates.sort(key=lambda x: x[0], reverse=True)

        # 4. Try opening a stream on these devices in order
        for priority, dev_idx, dev_name in device_candidates:
            # Get default rate for this device
            dev_default_rate = 16000
            try:
                dev_info = pa.get_device_info_by_index(dev_idx)
                dev_default_rate = int(dev_info.get("defaultSampleRate", 16000))
            except Exception:
                pass

            # Sample rates to try:
            rates_to_try = [self._sample_rate]
            if dev_default_rate not in rates_to_try:
                rates_to_try.append(dev_default_rate)
            for r in [44100, 48000, 32000, 8000, 22050, 11025]:
                if r not in rates_to_try:
                    rates_to_try.append(r)

            # Channels to try:
            channels_to_try = [self._channels]
            if 1 not in channels_to_try:
                channels_to_try.append(1)
            if 2 not in channels_to_try:
                channels_to_try.append(2)

            for ch in channels_to_try:
                for rate in rates_to_try:
                    try:
                        trial_chunk_size = self._chunk_size
                        if rate != self._sample_rate:
                            trial_chunk_size = int(round(self._chunk_size * (rate / self._sample_rate)))

                        logger.debug(f"[Capture] Trying device '{dev_name}' [{dev_idx}] with rate={rate}, channels={ch}, chunk_size={trial_chunk_size}")

                        stream = pa.open(
                            format=pyaudio.paInt16,
                            channels=ch,
                            rate=rate,
                            input=True,
                            input_device_index=dev_idx,
                            frames_per_buffer=trial_chunk_size,
                        )
                        # Succeeded! Return all details
                        logger.info(f"[Capture] Successfully opened device '{dev_name}' [{dev_idx}] (rate: {rate} Hz, channels: {ch})")
                        return stream, dev_idx, rate, ch, dev_name
                    except Exception as e:
                        logger.debug(f"[Capture] Failed to open device '{dev_name}' [{dev_idx}] with rate={rate}, channels={ch}: {e}")
                        continue

        return None, -1, 0, 0, ""

    def _capture_loop(self) -> None:
        try:
            import pyaudio
        except ImportError:
            logger.error("[Capture] pyaudio not installed!")
            return

        while self._running:
            pa = None
            stream = None
            try:
                pa = pyaudio.PyAudio()
                stream, dev_idx, device_rate, opened_channels, dev_name = self._find_working_stream(pa)

                if stream is None:
                    logger.error("[Capture] Could not open any audio input device. Retrying in 5 seconds...")
                    pa.terminate()
                    # Wait and retry if still running
                    for _ in range(50):
                        if not self._running:
                            break
                        time.sleep(0.1)
                    continue

                # Update actual device name and index in self
                with self._lock:
                    self._actual_device_name = dev_name

                # Configure chunk sizes
                device_chunk_size = self._chunk_size
                needs_resampling = False
                if device_rate != self._sample_rate:
                    device_chunk_size = int(round(self._chunk_size * (device_rate / self._sample_rate)))
                    needs_resampling = True
                    logger.info(f"[Capture] Resampling enabled: mic rate {device_rate} Hz -> target {self._sample_rate} Hz (chunk: {device_chunk_size} -> {self._chunk_size})")

                logger.info(f"[Capture] Microphone open: {self._actual_device_name} (rate: {device_rate} Hz, channels: {opened_channels})")

                fps = self._sample_rate // self._chunk_size
                speech_frames: List[bytes] = []
                silence_frames = 0
                consecutive_speech_frames = 0
                is_recording = False
                last_vad_state = "silence"

                segment_start_mono = 0.0

                while self._running:
                    with self._lock:
                        threshold = self._vad_threshold
                        silence_limit = int(self._silence_duration * fps)
                        min_frames = int(self._min_speech_duration * fps)
                        max_frames = int(self._max_segment_duration * fps)
                        vad = self._vad
                        calibrating = self._calibrating
                        calibration_limit = self._calibration_limit

                    try:
                        data = stream.read(device_chunk_size, exception_on_overflow=False)
                    except Exception as stream_err:
                        logger.error(f"[Capture] Stream read error: {stream_err}. Reconnecting stream...")
                        break  # Break inner loop to reconnect

                    ts = time.monotonic()

                    # Process data (Downmix & Resample)
                    if data:
                        try:
                            shorts = np.frombuffer(data, dtype=np.int16)
                            # 1. Downmix to mono if stream opened in stereo
                            if opened_channels == 2:
                                if len(shorts) % 2 == 0:
                                    shorts = shorts.reshape(-1, 2).mean(axis=1).astype(np.int16)
                                else:
                                    shorts = shorts[:-1].reshape(-1, 2).mean(axis=1).astype(np.int16)

                            # 2. Resample if rate is different from target sample rate
                            if needs_resampling and len(shorts) > 1:
                                x_old = np.linspace(0, len(shorts) - 1, num=len(shorts))
                                x_new = np.linspace(0, len(shorts) - 1, num=self._chunk_size)
                                shorts = np.interp(x_new, x_old, shorts).astype(np.int16)

                            data = shorts.tobytes()
                        except Exception as ex:
                            logger.error(f"[Capture] Processing/Resampling error: {ex}")

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
                            if consecutive_speech_frames >= 2:
                                is_recording = True
                                speech_frames = [data]
                                segment_start_mono = ts - (self._chunk_size / self._sample_rate)
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
                                self._flush_segment(speech_frames, fps, min_frames, "silence", segment_start_mono, ts)
                                speech_frames = []
                                silence_frames = 0
                                is_recording = False

                    # Max segment length
                    if is_recording and len(speech_frames) >= max_frames:
                        self._flush_segment(speech_frames, fps, min_frames, "maxlen", segment_start_mono, ts)
                        speech_frames = []
                        silence_frames = 0
                        is_recording = False

                    # Smoothed VAD state
                    vad_state = "speech" if is_recording else "silence"

                    if vad_state != last_vad_state and self._vad_state_cb:
                        self._vad_state_cb(vad_state, rms)
                        last_vad_state = vad_state

            except Exception as e:
                logger.error(f"[Capture] Capture loop error: {e}")
            finally:
                if stream is not None:
                    try:
                        stream.stop_stream()
                        stream.close()
                    except Exception:
                        pass
                if pa is not None:
                    try:
                        pa.terminate()
                    except Exception:
                        pass
                logger.info("[Capture] Audio stream closed/cleaned up")
                # Wait before retrying to connect
                time.sleep(1.0)


    def _flush_segment(
        self,
        frames: List[bytes],
        fps: int,
        min_frames: int,
        reason: str,
        start_mono: float,
        end_mono: float,
    ) -> None:
        duration = len(frames) / fps
        if len(frames) < min_frames:
            logger.debug(f"[VAD] Segment too short ({duration:.1f}s), discarding")
            return

        pcm = b"".join(frames)
        self._segment_queue.put({
            "pcm": pcm,
            "timestamp": time.time(),
            "start_mono": start_mono,
            "end_mono": end_mono,
            "duration_s": duration,
            "reason": reason,
        })
        logger.debug(f"[VAD] Segment queued: {duration:.1f}s ({reason}), Q={self._segment_queue.qsize()}")
