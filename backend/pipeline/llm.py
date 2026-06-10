"""
llm.py — Fraud LLM analysis module.

Modes:
  - api:   Groq LLM API
  - local: Ollama / RKLLama (compatible endpoints)
  - auto:  Try API first, fallback to local

Returns structured FraudResult from JSON response.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────
# Result
# ─────────────────────────────────────────────────────────

class FraudResult:
    def __init__(self, raw: Dict[str, Any], mode_used: str, elapsed_ms: int, error: Optional[str] = None, mapping: Optional[Dict[str, str]] = None):
        self.fraud_flags = raw.get("fraud_flags", {})
        self.evidence = raw.get("evidence", [])
        self.reason = raw.get("reason", "")
        self.mode_used = mode_used
        self.elapsed_ms = elapsed_ms
        self.error = error
        self.raw = raw
        self.confidence = 100  # Default to 100 for schema compatibility

        if error:
            self.classification = "ERROR"
            self.risk_level = "low"
        else:
            default_mapping = {
                "leasing_redirection": "FRAUD",
                "personal_contact": "SUSPICIOUS",
                "outside_process": "SUSPICIOUS",
                "data_manipulation": "FRAUD",
                "payment_diversion": "FRAUD"
            }
            active_mapping = mapping if mapping is not None else default_mapping
            
            has_fraud = False
            has_suspicious = False
            
            for k, is_active in self.fraud_flags.items():
                if is_active:
                    norm_key = k.replace("FRAUD_", "").replace("SUSPICIOUS_", "").lower()
                    mapped_cls = active_mapping.get(norm_key, "NORMAL").upper()
                    if mapped_cls == "FRAUD":
                        has_fraud = True
                    elif mapped_cls == "SUSPICIOUS":
                        has_suspicious = True
            
            if has_fraud:
                self.classification = "FRAUD"
                self.risk_level = "high"
            elif has_suspicious:
                self.classification = "SUSPICIOUS"
                self.risk_level = "medium"
            else:
                self.classification = "NORMAL"
                self.risk_level = "low"

    @property
    def is_alert(self) -> bool:
        return self.classification in {"FRAUD", "SUSPICIOUS"}

    @property
    def verdict(self) -> str:
        """Simplified verdict for DB/UI."""
        return self.classification  # NORMAL, SUSPICIOUS, FRAUD, ERROR

    @property
    def active_flags(self) -> List[str]:
        return [k for k, v in self.fraud_flags.items() if v]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "classification": self.classification,
            "verdict": self.verdict,
            "confidence": self.confidence,
            "risk_level": self.risk_level,
            "fraud_flags": self.fraud_flags,
            "evidence": self.evidence,
            "reason": self.reason,
            "mode_used": self.mode_used,
            "elapsed_ms": self.elapsed_ms,
        }


def _error_result(mode_used: str, elapsed_ms: int, reason: str) -> FraudResult:
    return FraudResult(
        raw={"fraud_flags": {}, "evidence": [], "reason": reason},
        mode_used=mode_used, elapsed_ms=elapsed_ms, error=reason,
    )


# ─────────────────────────────────────────────────────────
# JSON Extraction
# ─────────────────────────────────────────────────────────

def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Extract first valid JSON object from LLM response."""
    # Strip markdown fences
    text = text.replace("```json", "").replace("```", "").strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass
    return None


# ─────────────────────────────────────────────────────────
# Groq API LLM
# ─────────────────────────────────────────────────────────

class GroqLLM:
    def __init__(self, api_key: str, model: str, timeout: int = 90):
        from groq import Groq
        self._client = Groq(api_key=api_key)
        self._model = model
        self._timeout = timeout

    def analyze(self, transcript: str, system_prompt: str, context: Optional[str] = None, mapping: Optional[Dict[str, str]] = None) -> FraudResult:
        t0 = time.time()
        try:
            messages = [
                {"role": "system", "content": system_prompt},
            ]
            if context:
                messages.append({"role": "user", "content": f"Recent Conversation Context:\n{context}"})
            messages.append({"role": "user", "content": f'Current Segment Transcript:\n"{transcript}"\n\nAnalysis:'})

            response = self._client.chat.completions.create(
                model=self._model,
                temperature=0,
                max_tokens=1024,
                timeout=self._timeout,
                messages=messages,
            )
            raw_text = response.choices[0].message.content or ""
            elapsed = int((time.time() - t0) * 1000)
            parsed = _extract_json(raw_text)
            if parsed:
                return FraudResult(raw=parsed, mode_used="api", elapsed_ms=elapsed, mapping=mapping)
            return _error_result("api", elapsed, f"Invalid JSON from LLM: {raw_text[:80]}")
        except Exception as e:
            elapsed = int((time.time() - t0) * 1000)
            logger.warning(f"[LLM] Groq API error: {e}")
            return _error_result("api", elapsed, str(e))


# ─────────────────────────────────────────────────────────
# Local Ollama / RKLLama LLM
# ─────────────────────────────────────────────────────────

class LocalLLM:
    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "qwen2.5:1.5b",
        endpoint_type: str = "ollama",
        timeout: int = 90,
    ):
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._endpoint_type = endpoint_type
        self._timeout = timeout

    def analyze(self, transcript: str, system_prompt: str, context: Optional[str] = None, mapping: Optional[Dict[str, str]] = None) -> FraudResult:
        t0 = time.time()
        try:
            if self._endpoint_type == "ollama":
                return self._analyze_ollama(transcript, system_prompt, t0, context=context, mapping=mapping)
            else:
                return self._analyze_openai(transcript, system_prompt, t0, context=context, mapping=mapping)
        except Exception as e:
            elapsed = int((time.time() - t0) * 1000)
            logger.error(f"[LLM] Local error: {e}")
            return _error_result("local", elapsed, str(e))

    def _analyze_ollama(self, transcript: str, system_prompt: str, t0: float, context: Optional[str] = None, mapping: Optional[Dict[str, str]] = None) -> FraudResult:
        prompt = system_prompt + "\n\n"
        if context:
            prompt += f"Recent Conversation Context:\n{context}\n\n"
        prompt += f'Current Segment Transcript:\n"{transcript}"\n\nAnalysis:'

        with httpx.Client(timeout=self._timeout) as client:
            resp = client.post(
                f"{self._base_url}/api/generate",
                json={"model": self._model, "prompt": prompt, "stream": False},
            )
            resp.raise_for_status()
            data = resp.json()
            raw_text = data.get("response", "")

        elapsed = int((time.time() - t0) * 1000)
        parsed = _extract_json(raw_text)
        if parsed:
            return FraudResult(raw=parsed, mode_used="local", elapsed_ms=elapsed, mapping=mapping)
        return _error_result("local", elapsed, f"Invalid JSON: {raw_text[:80]}")

    def _analyze_openai(self, transcript: str, system_prompt: str, t0: float, context: Optional[str] = None, mapping: Optional[Dict[str, str]] = None) -> FraudResult:
        with httpx.Client(timeout=self._timeout) as client:
            messages = [
                {"role": "system", "content": system_prompt},
            ]
            if context:
                messages.append({"role": "user", "content": f"Recent Conversation Context:\n{context}"})
            messages.append({"role": "user", "content": f'Current Segment Transcript:\n"{transcript}"\n\nAnalysis:'})

            resp = client.post(
                f"{self._base_url}/v1/chat/completions",
                json={
                    "model": self._model,
                    "temperature": 0,
                    "messages": messages,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            raw_text = data["choices"][0]["message"]["content"]

        elapsed = int((time.time() - t0) * 1000)
        parsed = _extract_json(raw_text)
        if parsed:
            return FraudResult(raw=parsed, mode_used="local", elapsed_ms=elapsed, mapping=mapping)
        return _error_result("local", elapsed, f"Invalid JSON: {raw_text[:80]}")


# ─────────────────────────────────────────────────────────
# LLM Engine
# ─────────────────────────────────────────────────────────

class LLMEngine:
    """Unified LLM interface with mode switching."""

    def __init__(
        self,
        mode: str = "auto",
        groq_api_key: str = "",
        groq_model: str = "meta-llama/llama-4-scout-17b-16e-instruct",
        local_url: str = "http://localhost:11434",
        local_model: str = "qwen2.5:1.5b",
        local_endpoint_type: str = "ollama",
        timeout: int = 90,
    ):
        self._mode = mode
        self._groq: Optional[GroqLLM] = None
        self._local: Optional[LocalLLM] = None

        if groq_api_key:
            self._groq = GroqLLM(api_key=groq_api_key, model=groq_model, timeout=timeout)

        self._local = LocalLLM(
            base_url=local_url,
            model=local_model,
            endpoint_type=local_endpoint_type,
            timeout=timeout,
        )

    def analyze(self, transcript: str, system_prompt: str, context: Optional[str] = None, mapping: Optional[Dict[str, str]] = None) -> FraudResult:
        mode = self._mode

        if mode == "api":
            if self._groq:
                return self._groq.analyze(transcript, system_prompt, context=context, mapping=mapping)
            return _error_result("api", 0, "Groq not configured")

        if mode == "local":
            return self._local.analyze(transcript, system_prompt, context=context, mapping=mapping)

        # auto: try API first, fallback to local
        if self._groq:
            result = self._groq.analyze(transcript, system_prompt, context=context, mapping=mapping)
            if result.error is None:
                return result
            logger.warning(f"[LLM] API failed ({result.error}), trying local fallback")

        return self._local.analyze(transcript, system_prompt, context=context, mapping=mapping)

    def update_mode(self, mode: str) -> None:
        self._mode = mode

    def update_local_config(self, url: str, model: str, endpoint_type: str, timeout: int) -> None:
        self._local = LocalLLM(
            base_url=url, model=model,
            endpoint_type=endpoint_type, timeout=timeout,
        )

    @property
    def current_mode(self) -> str:
        return self._mode
