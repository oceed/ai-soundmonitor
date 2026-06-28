"""
config.py — Application settings using Pydantic Settings.

Static config loaded from .env at startup.
Runtime config is stored in SQLite and cached via RuntimeConfig.
"""

from __future__ import annotations

import json
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Literal, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ─────────────────────────────────────────────────────────
# Static Environment Settings
# ─────────────────────────────────────────────────────────

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # Auth
    jwt_secret_key: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24
    admin_username: str = "admin"
    admin_password: str = "admin123"

    # Groq
    groq_api_key: str = ""
    groq_stt_model: str = "whisper-large-v3-turbo"
    groq_llm_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"

    # Local STT
    local_whisper_model: str = "base"
    local_whisper_device: str = "cpu"
    local_whisper_compute_type: str = "int8"
    stt_language: Optional[str] = "id"

    # Local LLM
    local_llm_url: str = "http://localhost:11434"
    local_llm_model: str = "qwen2.5:1.5b"
    local_llm_endpoint_type: Literal["ollama", "openai"] = "ollama"

    # Mode
    stt_mode: Literal["api", "local", "auto"] = "auto"
    llm_mode: Literal["api", "local", "auto"] = "auto"

    # Audio
    sample_rate: int = 16000
    channels: int = 1
    chunk_size: int = 512
    audio_device_index: int = -1

    # VAD
    vad_threshold: float = 300.0
    vad_silence_duration: float = 1.5
    vad_min_speech_duration: float = 0.5
    vad_max_segment_duration: float = 15.0
    vad_use_silero: bool = False

    # Recording
    pre_buffer_seconds: float = 10.0
    post_buffer_seconds: float = 15.0
    recording_format: Literal["wav", "ogg"] = "ogg"
    record_on_verdict: Literal["FRAUD", "SUSPICIOUS", "BOTH", "ALL"] = "BOTH"
    continuous_recording_enabled: bool = False
    continuous_chunk_minutes: int = 10
    vad_auto_calibrate: bool = True

    # Retention
    retention_days: int = 7

    # MQTT
    mqtt_enabled: bool = False
    mqtt_broker_host: str = "localhost"
    mqtt_broker_port: int = 1883
    mqtt_topic: str = "voiceguard/fraud/alerts"
    mqtt_client_id: str = "voiceguard-fraud-detector"
    mqtt_username: str = ""
    mqtt_password: str = ""
    mqtt_use_tls: bool = False
    mqtt_qos: int = 1
    mqtt_retain: bool = False

    # Audio Upload
    audio_upload_enabled: bool = False
    audio_upload_url: str = ""
    audio_upload_api_key: str = ""
    audio_upload_timeout: int = 30
    audio_upload_id_path: str = "id"

    # Storage
    storage_path: str = "/app/storage"
    database_path: str = "/app/storage/fraud_detection.db"

    # Server
    backend_host: str = "0.0.0.0"
    backend_port: int = 8013
    cors_origins: str = "http://localhost:3000"

    # Timeouts
    stt_timeout: int = 120
    llm_timeout: int = 90

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def storage_dir(self) -> Path:
        return Path(self.storage_path)

    @property
    def recordings_dir(self) -> Path:
        return self.storage_dir / "recordings"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


# ─────────────────────────────────────────────────────────
# Runtime Config — DB-backed, in-memory cache
# ─────────────────────────────────────────────────────────

_DEFAULT_SYSTEM_PROMPT_BASE = """Anda adalah Petugas Kepatuhan AI untuk VoiceGuard dari ProtectQube.

Tugas Anda adalah menganalisis transkrip percakapan yang ditangkap dari Speech-to-Text (STT) di lokasi toko/retail.

PENTING:
- Transkrip mungkin tidak sempurna karena kesalahan STT. Fokuslah pada substansi pembicaraan, bukan ejaan.
- Bersikaplah objektif. Jangan mengasumsikan adanya kecurangan tanpa bukti yang jelas."""


def compile_system_prompt(base_instructions: str, categories: list) -> str:
    # construct the categories part
    cats_str = ""
    for i, cat in enumerate(categories):
        key = cat.get("key", "")
        label = cat.get("label", "")
        desc = cat.get("description", "")
        cats_str += f"{i+1}. {key}: {desc or label}\n"
    
    # construct the JSON format template
    flags_lines = []
    for cat in categories:
        key = cat.get("key", "")
        flags_lines.append(f'    "{key}": false')
    flags_str = ",\n".join(flags_lines)
    
    compiled = f"""{base_instructions.strip()}

Deteksi indikator kecurangan (fraud flags) berikut:
{cats_str.strip()}

Output HARUS hanya berupa JSON valid tanpa penjelasan tambahan di luar JSON. Jangan gunakan markdown block ```json.

Format JSON Output:
{{
  "fraud_flags": {{
{flags_str}
  }},
  "evidence": [],
  "reason": ""
}}

Keterangan:
- "fraud_flags": bernilai true jika indikator tersebut terdeteksi dalam transkrip percakapan, jika tidak bernilai false.
- "evidence": daftar kutipan kalimat langsung dari transkrip yang menjadi bukti adanya indikator kecurangan tersebut. Jika tidak ada, biarkan kosong [].
- "reason": penjelasan singkat dan jelas mengapa indikator tersebut terdeteksi atau tidak terdeteksi."""
    return compiled


_DEFAULT_RUNTIME_CONFIG: Dict[str, Any] = {
    "system_prompt_base": _DEFAULT_SYSTEM_PROMPT_BASE,
    "system_prompt": "",  # Set dynamically below
    "fraud_categories": [
        {"key": "leasing_redirection", "label": "Leasing Redirection", "description": "Agen mengarahkan pelanggan ke perusahaan leasing lain", "classification": "FRAUD"},
        {"key": "personal_contact", "label": "Personal Contact", "description": "Agen membagikan kontak pribadi untuk transaksi luar sistem resmi", "classification": "SUSPICIOUS"},
        {"key": "outside_process", "label": "Outside Process", "description": "Transaksi atau negosiasi di luar proses resmi", "classification": "SUSPICIOUS"},
        {"key": "data_manipulation", "label": "Data Manipulation", "description": "Agen memanipulasi atau memalsukan data pelanggan", "classification": "FRAUD"},
        {"key": "payment_diversion", "label": "Payment Diversion", "description": "Agen mengarahkan pembayaran ke rekening pribadi atau tidak resmi", "classification": "FRAUD"},
        {"key": "upsell_cross_sell", "label": "Upsell & Cross-sell", "description": "Agen menawarkan produk tambahan, top-up dana, atau produk pembiayaan lainnya", "classification": "NORMAL"},
    ],
    "alert_verdicts": ["FRAUD", "SUSPICIOUS"],
    "device_name": "VoiceGuard-Store-01",
    # These mirror .env but can be overridden at runtime
    "stt_mode": "auto",
    "stt_language": "id",
    "llm_mode": "auto",
    "vad_threshold": 300.0,
    "vad_silence_duration": 1.5,
    "vad_min_speech_duration": 0.5,
    "vad_max_segment_duration": 15.0,
    "vad_use_silero": False,
    "vad_auto_calibrate": True,
    "continuous_recording_enabled": False,
    "continuous_chunk_minutes": 10,
    "alert_recording_mode": "exact_segment",
    "pre_buffer_seconds": 10.0,
    "post_buffer_seconds": 15.0,
    "retention_days": 7,
    "mqtt_enabled": False,
    "mqtt_broker_host": "localhost",
    "mqtt_broker_port": 1883,
    "mqtt_topic": "voiceguard/fraud/alerts",
    "mqtt_client_id": "voiceguard-fraud-detector",
    "mqtt_username": "",
    "mqtt_password": "",
    "mqtt_use_tls": False,
    "mqtt_qos": 1,
    "audio_upload_enabled": False,
    "audio_upload_url": "",
    "audio_upload_api_key": "",
    "audio_upload_id_path": "id",
    "audio_device_index": -1,
    "local_llm_url": "http://localhost:11434",
    "local_llm_model": "qwen2.5:1.5b",
    "local_llm_endpoint_type": "ollama",
    "local_whisper_model": "base",
    "sample_rate": 16000,
    "channels": 1,
    "chunk_size": 512,
    "context_limit": 5,
    "context_max_age_seconds": 300,
    "context_gap_threshold_seconds": 90,
}

_DEFAULT_RUNTIME_CONFIG["system_prompt"] = compile_system_prompt(
    _DEFAULT_SYSTEM_PROMPT_BASE,
    _DEFAULT_RUNTIME_CONFIG["fraud_categories"]
)


class RuntimeConfig:
    """
    Thread-safe in-memory config cache backed by SQLite.
    Load from DB on startup; patch updates both memory and DB.
    """

    def __init__(self):
        self._data: Dict[str, Any] = dict(_DEFAULT_RUNTIME_CONFIG)
        self._lock = threading.RLock()

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._data.get(key, default)

    def get_all(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._data)

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = value

    def update(self, updates: Dict[str, Any]) -> None:
        with self._lock:
            self._data.update(updates)

    def reset(self) -> None:
        with self._lock:
            self._data = dict(_DEFAULT_RUNTIME_CONFIG)

    def load_from_db_rows(self, rows: list) -> None:
        """Hydrate from DB config rows: [(key, value_json), ...]"""
        with self._lock:
            # Revert to default first
            self.reset()
            for key, value_json in rows:
                try:
                    self._data[key] = json.loads(value_json)
                except (json.JSONDecodeError, TypeError):
                    self._data[key] = value_json


# Singleton
runtime_config = RuntimeConfig()
