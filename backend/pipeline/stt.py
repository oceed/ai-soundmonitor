"""
stt.py — Speech-to-Text module.

Modes:
  - api:   Groq Whisper API (fast, requires internet)
  - local: faster-whisper on CPU (offline, slower)
  - auto:  Try API first, fallback to local on failure/timeout

Thread-safe. STTEngine is instantiated once and reused.
"""

from __future__ import annotations

import io
import logging
import time
import wave
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────
# Result
# ─────────────────────────────────────────────────────────

class STTResult:
    def __init__(self, text: str, mode_used: str, elapsed_ms: int, error: Optional[str] = None):
        cleaned_text = text.strip()
        
        # Filter out common Whisper hallucinations on silence/noise
        hallucination_patterns = [
            "ありがとうございました",
            "ご視聴ありがとうございました",
            "ご視聴いただきありがとうございました",
            "チャンネル登録",
            "thank you for watching",
            "subtitles by",
        ]
        
        lower_text = cleaned_text.lower()
        is_hallucination = False
        for pat in hallucination_patterns:
            if pat in lower_text:
                is_hallucination = True
                break
                
        if lower_text in ("thank you.", "thank you", "you"):
            is_hallucination = True
            
        if is_hallucination:
            logger.info(f"[STT] Filtered out Whisper hallucination: '{cleaned_text}'")
            cleaned_text = ""
            
        self.text = cleaned_text
        self.mode_used = mode_used
        self.elapsed_ms = elapsed_ms
        self.error = error
        self.success = error is None and bool(cleaned_text)


# ─────────────────────────────────────────────────────────
# Groq API STT
# ─────────────────────────────────────────────────────────

class GroqSTT:
    def __init__(self, api_key: str, model: str = "whisper-large-v3-turbo", timeout: int = 120):
        from groq import Groq
        self._client = Groq(api_key=api_key)
        self._model = model
        self._timeout = timeout

    def transcribe(self, pcm_bytes: bytes, sample_rate: int = 16000, channels: int = 1) -> STTResult:
        t0 = time.time()
        wav_bytes = _pcm_to_wav(pcm_bytes, sample_rate, channels)
        try:
            result = self._client.audio.transcriptions.create(
                file=("audio.wav", wav_bytes, "audio/wav"),
                model=self._model,
                response_format="text",
                language="id",
                timeout=self._timeout,
            )
            text = result if isinstance(result, str) else getattr(result, "text", "")
            elapsed = int((time.time() - t0) * 1000)
            return STTResult(text=text, mode_used="api", elapsed_ms=elapsed)
        except Exception as e:
            elapsed = int((time.time() - t0) * 1000)
            logger.warning(f"[STT] Groq API error: {e}")
            return STTResult(text="", mode_used="api", elapsed_ms=elapsed, error=str(e))


# ─────────────────────────────────────────────────────────
# Local faster-whisper STT
# ─────────────────────────────────────────────────────────

class LocalSTT:
    def __init__(self, model_name: str = "base", device: str = "cpu", compute_type: str = "int8"):
        self._model_name = model_name
        self._device = device
        self._compute_type = compute_type
        self._model = None  # Lazy load

    def _ensure_loaded(self) -> None:
        if self._model is None:
            from faster_whisper import WhisperModel
            logger.info(f"[STT] Loading faster-whisper model '{self._model_name}' on {self._device}...")
            self._model = WhisperModel(
                self._model_name,
                device=self._device,
                compute_type=self._compute_type,
            )
            logger.info("[STT] faster-whisper model loaded.")

    def transcribe(self, pcm_bytes: bytes, sample_rate: int = 16000, channels: int = 1) -> STTResult:
        t0 = time.time()
        self._ensure_loaded()
        try:
            wav_bytes = _pcm_to_wav(pcm_bytes, sample_rate, channels)
            buf = io.BytesIO(wav_bytes)
            segments, _ = self._model.transcribe(
                buf,
                beam_size=3,
                language="id",  # Indonesian; set to None for auto-detect
                vad_filter=False,  # We handle VAD ourselves
            )
            text = " ".join(seg.text for seg in segments)
            elapsed = int((time.time() - t0) * 1000)
            return STTResult(text=text, mode_used="local", elapsed_ms=elapsed)
        except Exception as e:
            elapsed = int((time.time() - t0) * 1000)
            logger.error(f"[STT] Local whisper error: {e}")
            return STTResult(text="", mode_used="local", elapsed_ms=elapsed, error=str(e))


# ─────────────────────────────────────────────────────────
# STT Engine (mode dispatcher)
# ─────────────────────────────────────────────────────────

class STTEngine:
    """
    Unified STT interface with mode switching.
    Thread-safe — transcribe() can be called from multiple threads.
    """

    def __init__(
        self,
        mode: str = "auto",
        groq_api_key: str = "",
        groq_model: str = "whisper-large-v3-turbo",
        local_model: str = "base",
        local_device: str = "cpu",
        local_compute_type: str = "int8",
        timeout: int = 120,
    ):
        self._mode = mode
        self._groq: Optional[GroqSTT] = None
        self._local: Optional[LocalSTT] = None
        self._timeout = timeout

        if groq_api_key:
            self._groq = GroqSTT(api_key=groq_api_key, model=groq_model, timeout=timeout)

        if mode in ("local", "auto"):
            self._local = LocalSTT(
                model_name=local_model,
                device=local_device,
                compute_type=local_compute_type,
            )

    def transcribe(self, pcm_bytes: bytes, sample_rate: int = 16000, channels: int = 1) -> STTResult:
        mode = self._mode

        if mode == "api":
            if self._groq:
                return self._groq.transcribe(pcm_bytes, sample_rate, channels)
            return STTResult("", "api", 0, "Groq not configured")

        if mode == "local":
            if self._local:
                return self._local.transcribe(pcm_bytes, sample_rate, channels)
            return STTResult("", "local", 0, "Local STT not configured")

        # auto: try API, fallback to local
        if self._groq:
            result = self._groq.transcribe(pcm_bytes, sample_rate, channels)
            if result.success:
                return result
            logger.warning(f"[STT] API failed ({result.error}), trying local fallback")

        if self._local:
            return self._local.transcribe(pcm_bytes, sample_rate, channels)

        return STTResult("", "auto", 0, "No STT backend available")

    def update_mode(self, mode: str) -> None:
        self._mode = mode

    @property
    def current_mode(self) -> str:
        return self._mode


# ─────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────

def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int, channels: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    buf.seek(0)
    return buf.read()
