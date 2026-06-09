"""
vad.py — Voice Activity Detection.

Two implementations:
  - EnergyVAD: RMS-based, zero dependencies, default.
  - SileroVAD: ONNX-based Silero model, more accurate (optional).

The Orchestrator uses only EnergyVAD unless vad_use_silero=True in config.
"""

from __future__ import annotations

import struct
from typing import Optional

import numpy as np


# ─────────────────────────────────────────────────────────
# Energy-based VAD (always available)
# ─────────────────────────────────────────────────────────

class EnergyVAD:
    """Simple RMS energy threshold VAD."""

    def __init__(self, threshold: float = 300.0):
        self.threshold = threshold

    def get_rms(self, audio_chunk: bytes) -> float:
        n = len(audio_chunk) // 2
        if n == 0:
            return 0.0
        shorts = struct.unpack(f"{n}h", audio_chunk[:n * 2])
        arr = np.array(shorts, dtype=np.float32)
        return float(np.sqrt(np.mean(arr ** 2)))

    def is_speech(self, audio_chunk: bytes) -> bool:
        return self.get_rms(audio_chunk) > self.threshold

    def update_threshold(self, threshold: float) -> None:
        self.threshold = threshold


# ─────────────────────────────────────────────────────────
# Silero VAD (optional, ONNX-based)
# ─────────────────────────────────────────────────────────

class SileroVAD:
    """
    Silero VAD using ONNX Runtime.
    Downloads model silero_vad.onnx on first use.
    Compatible with ARM64 via onnxruntime package.
    """

    MODEL_URL = "https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx"
    SAMPLE_RATE = 16000
    WINDOW_SIZE_SAMPLES = 512  # must match CHUNK size

    def __init__(self, threshold: float = 0.5, model_path: str = "/app/storage/silero_vad.onnx"):
        self.threshold = threshold
        self.model_path = model_path
        self._session = None
        self._h = np.zeros((2, 1, 64), dtype=np.float32)
        self._c = np.zeros((2, 1, 64), dtype=np.float32)
        self._load_model()

    def _load_model(self) -> None:
        try:
            import onnxruntime as ort
            import os
            if not os.path.exists(self.model_path):
                self._download_model()
            self._session = ort.InferenceSession(
                self.model_path,
                providers=["CPUExecutionProvider"]
            )
        except ImportError:
            raise RuntimeError(
                "onnxruntime is required for Silero VAD. "
                "Install it: pip install onnxruntime"
            )
        except Exception as e:
            raise RuntimeError(f"Failed to load Silero VAD model: {e}")

    def _download_model(self) -> None:
        import urllib.request
        import os
        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
        print(f"[VAD] Downloading Silero VAD model to {self.model_path}...")
        urllib.request.urlretrieve(self.MODEL_URL, self.model_path)
        print("[VAD] Silero VAD model downloaded.")

    def get_rms(self, audio_chunk: bytes) -> float:
        """Still provide RMS for VU meter even when using Silero."""
        n = len(audio_chunk) // 2
        if n == 0:
            return 0.0
        shorts = struct.unpack(f"{n}h", audio_chunk[:n * 2])
        arr = np.array(shorts, dtype=np.float32)
        return float(np.sqrt(np.mean(arr ** 2)))

    def is_speech(self, audio_chunk: bytes) -> bool:
        if self._session is None:
            return False
        n = len(audio_chunk) // 2
        arr = np.frombuffer(audio_chunk[:n * 2], dtype=np.int16).astype(np.float32) / 32768.0

        # Pad or trim to window size
        if len(arr) < self.WINDOW_SIZE_SAMPLES:
            arr = np.pad(arr, (0, self.WINDOW_SIZE_SAMPLES - len(arr)))
        else:
            arr = arr[:self.WINDOW_SIZE_SAMPLES]

        arr = arr.reshape(1, -1)
        sr = np.array(self.SAMPLE_RATE, dtype=np.int64)

        out, h, c = self._session.run(
            None,
            {"input": arr, "sr": sr, "h": self._h, "c": self._c}
        )
        self._h = h
        self._c = c
        return float(out[0][0]) > self.threshold

    def reset_state(self) -> None:
        self._h = np.zeros((2, 1, 64), dtype=np.float32)
        self._c = np.zeros((2, 1, 64), dtype=np.float32)


# ─────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────

def create_vad(use_silero: bool = False, threshold: float = 300.0):
    """Returns the appropriate VAD implementation."""
    if use_silero:
        try:
            return SileroVAD(threshold=threshold / 32768.0)  # normalize threshold for Silero
        except Exception as e:
            print(f"[VAD] Silero init failed ({e}), falling back to EnergyVAD")
    return EnergyVAD(threshold=threshold)
