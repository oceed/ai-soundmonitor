"""
recorder.py — Pre/post buffer audio recording.

Design:
  - RingBuffer: circular in-memory PCM buffer (pre-buffer)
  - When fraud detected, extract pre_buffer_s from ring + wait post_buffer_s
  - Save combined audio to OGG or WAV
  - Thread-safe
"""

from __future__ import annotations

import io
import logging
import os
import threading
import time
import wave
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────
# Ring Buffer (circular PCM store)
# ─────────────────────────────────────────────────────────

class RingBuffer:
    """
    Thread-safe circular PCM audio buffer with timestamps.
    Stores up to `max_seconds` of audio, dropping oldest.
    """

    def __init__(self, max_seconds: float, sample_rate: int = 16000, channels: int = 1):
        self._max_samples = int(max_seconds * sample_rate * channels)
        self._sample_rate = sample_rate
        self._channels = channels
        self._buffer: deque[Tuple[float, bytes]] = deque()
        self._total_samples = 0
        self._lock = threading.Lock()

    def push(self, chunk: bytes, timestamp: float) -> None:
        samples = len(chunk) // 2  # 16-bit → 2 bytes per sample
        with self._lock:
            self._buffer.append((timestamp, chunk))
            self._total_samples += samples
            # Trim oldest
            while self._total_samples > self._max_samples and self._buffer:
                _, old_chunk = self._buffer.popleft()
                self._total_samples -= len(old_chunk) // 2

    def get_since(self, since_timestamp: float) -> bytes:
        with self._lock:
            chunks = [chunk for ts, chunk in self._buffer if ts >= since_timestamp]
            return b"".join(chunks)

    def get_last_n_seconds(self, n_seconds: float) -> bytes:
        cutoff = time.monotonic() - n_seconds
        return self.get_since(cutoff)

    def get_range(self, start_ts: float, end_ts: float) -> bytes:
        with self._lock:
            overlapping = []
            first_start = None
            for ts, chunk in self._buffer:
                chunk_duration = len(chunk) / (self._sample_rate * 2 * self._channels)
                chunk_start = ts - chunk_duration
                if ts >= start_ts and chunk_start <= end_ts:
                    if first_start is None:
                        first_start = chunk_start
                    overlapping.append(chunk)
            
            if not overlapping:
                return b""
            
            all_pcm = b"".join(overlapping)
            
            # Trim prefix
            if first_start < start_ts:
                skip_bytes = int(round((start_ts - first_start) * self._sample_rate)) * 2 * self._channels
                sample_bytes = 2 * self._channels
                skip_bytes = (skip_bytes // sample_bytes) * sample_bytes
                if skip_bytes > 0:
                    all_pcm = all_pcm[skip_bytes:]
            
            # Trim suffix
            expected_len = int(round((end_ts - start_ts) * self._sample_rate)) * 2 * self._channels
            sample_bytes = 2 * self._channels
            expected_len = (expected_len // sample_bytes) * sample_bytes
            if len(all_pcm) > expected_len:
                all_pcm = all_pcm[:expected_len]
                
            return all_pcm

    def snapshot(self) -> bytes:
        """Get all buffered audio."""
        with self._lock:
            return b"".join(chunk for _, chunk in self._buffer)


# ─────────────────────────────────────────────────────────
# Recorder
# ─────────────────────────────────────────────────────────

class Recorder:
    """
    Manages pre/post buffer recording.

    Usage:
      1. Call push_chunk() continuously from audio capture thread.
      2. Call start_alert_recording(alert_id, pre_s) when fraud detected.
      3. Recorder keeps collecting for post_s more seconds.
      4. Call get_recording_path(alert_id) to get the saved file path.
    """

    def __init__(
        self,
        recordings_dir: Path,
        pre_buffer_s: float = 10.0,
        post_buffer_s: float = 15.0,
        recording_format: str = "ogg",
        sample_rate: int = 16000,
        channels: int = 1,
        continuous_enabled: bool = False,
        continuous_chunk_minutes: int = 10,
        db_writer = None,
        max_segment_duration: float = 15.0,
    ):
        self._recordings_dir = recordings_dir
        self._pre_buffer_s = pre_buffer_s
        self._post_buffer_s = post_buffer_s
        self._format = recording_format
        self._sample_rate = sample_rate
        self._channels = channels
        self._max_segment_duration = max_segment_duration

        # Continuous recording settings
        self._continuous_enabled = continuous_enabled
        self._continuous_chunk_minutes = continuous_chunk_minutes
        self._db_writer = db_writer
        self._session_id: Optional[int] = None

        # Continuous recording active file state
        self._continuous_file = None
        self._continuous_raw_path = None
        self._continuous_start_time = None
        self._continuous_samples = 0
        self._continuous_max_samples = 0

        # Ring buffer — size dynamically to hold the max speech segment plus buffers and margin
        self._ring = RingBuffer(
            max_seconds=pre_buffer_s + max_segment_duration + post_buffer_s + 30.0,
            sample_rate=sample_rate,
            channels=channels,
        )

        # Active recordings: {alert_id: {"start_ts": float, "post_chunks": list, "done": bool}}
        self._active: dict[int, dict] = {}
        self._lock = threading.Lock()

        recordings_dir.mkdir(parents=True, exist_ok=True)

    def set_session_id(self, session_id: int) -> None:
        with self._lock:
            self._session_id = session_id

    def update_params(
        self,
        pre_buffer_s: float,
        post_buffer_s: float,
        continuous_enabled: bool,
        continuous_chunk_minutes: int,
        max_segment_duration: float = 15.0,
        recording_format: str = "ogg",
    ) -> None:
        with self._lock:
            self._pre_buffer_s = pre_buffer_s
            self._post_buffer_s = post_buffer_s
            self._continuous_chunk_minutes = continuous_chunk_minutes
            self._max_segment_duration = max_segment_duration
            self._format = recording_format
            
            # Recreate RingBuffer with updated parameters
            self._ring = RingBuffer(
                max_seconds=pre_buffer_s + max_segment_duration + post_buffer_s + 30.0,
                sample_rate=self._sample_rate,
                channels=self._channels,
            )
            
            # Handle continuous recording toggling
            if continuous_enabled != self._continuous_enabled:
                self._continuous_enabled = continuous_enabled
                if continuous_enabled:
                    logger.info("[Recorder] Continuous recording dynamically enabled")
                else:
                    logger.info("[Recorder] Continuous recording dynamically disabled")
                    if self._continuous_file:
                        # Close and save the active continuous file
                        self._rotate_continuous_file()

    def push_chunk(self, chunk: bytes, timestamp: Optional[float] = None) -> None:
        """Call this for every audio chunk from the capture thread."""
        ts = timestamp if timestamp is not None else time.monotonic()
        self._ring.push(chunk, ts)

        # Write continuous stream if enabled
        if self._continuous_enabled:
            self._write_continuous_chunk(chunk)

        # Feed active post-buffer recordings
        with self._lock:
            now = time.monotonic()
            for alert_id, rec in list(self._active.items()):
                if rec["done"]:
                    continue
                elapsed_post = now - rec["start_ts"]
                if elapsed_post <= rec["post_s"]:
                    rec["post_chunks"].append(chunk)
                else:
                    # Post buffer complete — save file
                    rec["done"] = True
                    threading.Thread(
                        target=self._save_recording,
                        args=(alert_id, rec),
                        daemon=True,
                    ).start()

    def start_alert_recording(
        self,
        alert_id: int,
        verdict: str,
        segment_timestamp: datetime,
        start_mono: float,
        end_mono: float,
        pre_s: Optional[float] = None,
        post_s: Optional[float] = None,
    ) -> None:
        """
        Trigger a recording for the given alert using exact segment monotonic timestamps.
        """
        pre_s = pre_s if pre_s is not None else self._pre_buffer_s
        post_s = post_s if post_s is not None else self._post_buffer_s

        # Calculate exact start/end monotonic timestamps
        target_start_ts = start_mono - pre_s
        target_end_ts = end_mono + post_s

        now = time.monotonic()

        if now >= target_end_ts:
            # Entire window is already in the ring buffer
            recording_pcm = self._ring.get_range(target_start_ts, target_end_ts)
            
            with self._lock:
                self._active[alert_id] = {
                    "start_ts": now,
                    "pre_pcm": recording_pcm,
                    "post_chunks": [],
                    "post_s": 0.0,
                    "verdict": verdict,
                    "segment_timestamp": segment_timestamp,
                    "pre_s": pre_s,
                    "done": True,
                    "saved_path": None,
                }
            
            # Save in background thread immediately
            threading.Thread(
                target=self._save_recording,
                args=(alert_id, self._active[alert_id]),
                daemon=True,
            ).start()
            logger.info(
                f"[Recorder] Alert {alert_id} recording completed immediately from ring buffer "
                f"(total={pre_s + (end_mono - start_mono) + post_s:.1f}s)"
            )
        else:
            # Post buffer is still ongoing
            # Extract what we have from target_start_ts up to now
            pre_pcm = self._ring.get_range(target_start_ts, now)
            
            with self._lock:
                self._active[alert_id] = {
                    "start_ts": now,
                    "pre_pcm": pre_pcm,
                    "post_chunks": [],
                    "post_s": target_end_ts - now,
                    "verdict": verdict,
                    "segment_timestamp": segment_timestamp,
                    "pre_s": pre_s,
                    "done": False,
                    "saved_path": None,
                }
            logger.info(
                f"[Recorder] Alert {alert_id} recording started (pre_s={pre_s:.1f}s, "
                f"waiting for remaining post_s={target_end_ts - now:.1f}s)"
            )

    def save_exact_segment(
        self,
        alert_id: int,
        verdict: str,
        segment_timestamp: datetime,
        pcm: bytes,
    ) -> Optional[dict]:
        """
        Immediately saves the exact segment PCM bytes as a wav or ogg file,
        without using the RingBuffer or background threads.
        """
        if not pcm:
            logger.warning(f"[Recorder] Exact segment for alert {alert_id} has no audio data")
            return None

        ts = segment_timestamp
        date_dir = self._recordings_dir / ts.strftime("%Y-%m-%d")
        date_dir.mkdir(parents=True, exist_ok=True)

        verdict_short = verdict.replace("FRAUD_", "F_")
        filename = f"{ts.strftime('%H-%M-%S')}_{verdict_short}_{alert_id}.{self._format}"
        filepath = date_dir / filename

        try:
            if self._format == "ogg":
                self._save_ogg(pcm, filepath)
            else:
                self._save_wav(pcm, filepath)

            duration_s = len(pcm) / (self._sample_rate * 2 * self._channels)
            logger.info(
                f"[Recorder] Saved exact alert {alert_id} recording: {filepath.name} "
                f"({duration_s:.1f}s, {len(pcm)//1024}KB)"
            )
            return {
                "path": str(filepath),
                "duration_s": duration_s,
                "filename": filename,
            }
        except Exception as e:
            logger.error(f"[Recorder] Failed to save exact segment for alert {alert_id}: {e}")
            return None

    def _save_recording(self, alert_id: int, rec: dict) -> None:
        try:
            # Combine pre + post
            all_pcm = rec["pre_pcm"] + b"".join(rec["post_chunks"])
            if not all_pcm:
                logger.warning(f"[Recorder] Alert {alert_id}: no audio data")
                return

            ts = rec["segment_timestamp"]
            date_dir = self._recordings_dir / ts.strftime("%Y-%m-%d")
            date_dir.mkdir(parents=True, exist_ok=True)

            verdict_short = rec["verdict"].replace("FRAUD_", "F_")
            filename = f"{ts.strftime('%H-%M-%S')}_{verdict_short}_{alert_id}.{self._format}"
            filepath = date_dir / filename

            if self._format == "ogg":
                self._save_ogg(all_pcm, filepath)
            else:
                self._save_wav(all_pcm, filepath)

            duration_s = len(all_pcm) / (self._sample_rate * 2 * self._channels)
            logger.info(
                f"[Recorder] Alert {alert_id}: saved {filepath.name} "
                f"({duration_s:.1f}s, {len(all_pcm)//1024}KB)"
            )

            with self._lock:
                if alert_id in self._active:
                    self._active[alert_id]["saved_path"] = str(filepath)
                    self._active[alert_id]["duration_s"] = duration_s

        except Exception as e:
            logger.error(f"[Recorder] Failed to save alert {alert_id}: {e}")

    def _save_wav(self, pcm: bytes, path: Path) -> None:
        with wave.open(str(path), "wb") as wf:
            wf.setnchannels(self._channels)
            wf.setsampwidth(2)
            wf.setframerate(self._sample_rate)
            wf.writeframes(pcm)

    def _save_ogg(self, pcm: bytes, path: Path) -> None:
        arr = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        sf.write(str(path), arr, self._sample_rate, format="OGG", subtype="VORBIS")

    def get_recording_info(self, alert_id: int) -> Optional[dict]:
        """Returns dict with saved_path and duration_s once recording is done."""
        with self._lock:
            rec = self._active.get(alert_id)
            if rec and rec["done"] and rec.get("saved_path"):
                return {
                    "path": rec["saved_path"],
                    "duration_s": rec.get("duration_s", 0.0),
                    "filename": Path(rec["saved_path"]).name,
                }
        return None

    def wait_for_recording(self, alert_id: int, timeout: float = 60.0) -> Optional[dict]:
        """Block until recording is saved or timeout."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            info = self.get_recording_info(alert_id)
            if info:
                return info
            time.sleep(0.5)
        return None

    def cleanup_old(self, alert_id: int) -> None:
        with self._lock:
            self._active.pop(alert_id, None)

    def update_config(
        self,
        pre_buffer_s: Optional[float] = None,
        post_buffer_s: Optional[float] = None,
    ) -> None:
        with self._lock:
            if pre_buffer_s is not None:
                self._pre_buffer_s = pre_buffer_s
            if post_buffer_s is not None:
                self._post_buffer_s = post_buffer_s
            
            # Recreate RingBuffer with new parameters
            self._ring = RingBuffer(
                max_seconds=self._pre_buffer_s + getattr(self, '_max_segment_duration', 15.0) + self._post_buffer_s + 30.0,
                sample_rate=self._sample_rate,
                channels=self._channels,
            )

    # ──────────────────────────────────────────────────────
    # Continuous Recording Internals
    # ──────────────────────────────────────────────────────

    def _write_continuous_chunk(self, chunk: bytes) -> None:
        with self._lock:
            if self._continuous_file is None:
                self._start_new_continuous_file()
            
            if self._continuous_file:
                try:
                    self._continuous_file.write(chunk)
                    self._continuous_samples += len(chunk) // 2
                except Exception as e:
                    logger.error(f"[Recorder] Error writing continuous chunk: {e}")

            # Rotate if max samples reached
            if self._continuous_samples >= self._continuous_max_samples:
                self._rotate_continuous_file()

    def _start_new_continuous_file(self) -> None:
        self._continuous_start_time = datetime.now(timezone.utc)
        
        # Create continuous directory
        cont_dir = self._recordings_dir / "continuous" / self._continuous_start_time.strftime("%Y-%m-%d")
        cont_dir.mkdir(parents=True, exist_ok=True)
        
        filename = f"cont_{self._continuous_start_time.strftime('%H%M%S')}.raw"
        self._continuous_raw_path = cont_dir / filename
        
        try:
            self._continuous_file = open(self._continuous_raw_path, "wb")
            self._continuous_samples = 0
            self._continuous_max_samples = self._continuous_chunk_minutes * 60 * self._sample_rate
            logger.info(f"[Recorder] Started continuous recording: {filename}")
        except Exception as e:
            logger.error(f"[Recorder] Failed to open continuous raw file: {e}")
            self._continuous_file = None

    def _rotate_continuous_file(self) -> None:
        file_to_close = self._continuous_file
        raw_path = self._continuous_raw_path
        start_time = self._continuous_start_time
        samples = self._continuous_samples

        self._continuous_file = None
        self._continuous_raw_path = None
        self._continuous_start_time = None
        self._continuous_samples = 0

        if file_to_close:
            try:
                file_to_close.close()
                # Finalize in background thread
                threading.Thread(
                    target=self._finalize_continuous_file,
                    args=(raw_path, start_time, samples),
                    daemon=True,
                ).start()
            except Exception as e:
                logger.error(f"[Recorder] Error closing continuous file during rotation: {e}")

    def _finalize_continuous_file(self, raw_path: Path, start_time: datetime, samples: int) -> None:
        try:
            if not raw_path.exists():
                return
            
            with open(raw_path, "rb") as f:
                pcm = f.read()

            if not pcm:
                try:
                    raw_path.unlink()
                except:
                    pass
                return

            ext = self._format
            out_filename = raw_path.stem + f".{ext}"
            out_path = raw_path.parent / out_filename

            if ext == "ogg":
                self._save_ogg(pcm, out_path)
            else:
                self._save_wav(pcm, out_path)

            duration_s = len(pcm) / (self._sample_rate * 2 * self._channels)

            if self._db_writer and self._session_id:
                self._db_writer.save_continuous_recording(
                    session_id=self._session_id,
                    start_time=start_time,
                    end_time=datetime.now(timezone.utc),
                    filepath=str(out_path),
                    filename=out_filename,
                    duration_s=duration_s,
                )
                logger.info(f"[Recorder] Continuous chunk saved: {out_filename} ({duration_s:.1f}s)")
            else:
                logger.warning("[Recorder] Continuous chunk saved to disk but DB session or writer not available")

            # Clean raw
            try:
                raw_path.unlink()
            except Exception as e:
                logger.error(f"[Recorder] Error deleting raw continuous file: {e}")
        except Exception as e:
            logger.error(f"[Recorder] Error finalizing continuous recording: {e}")

    def stop_continuous_recording(self) -> None:
        with self._lock:
            if self._continuous_file:
                logger.info("[Recorder] Stopping continuous recording")
                self._rotate_continuous_file()
