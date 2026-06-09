"""
models.py — SQLAlchemy ORM models.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


# ─────────────────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(128), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────────────────
# Runtime Config Store
# ─────────────────────────────────────────────────────────

class ConfigEntry(Base):
    __tablename__ = "config"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)  # JSON-encoded
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────────────────
# Recording Sessions
# ─────────────────────────────────────────────────────────

class RecordingSession(Base):
    __tablename__ = "recording_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    device_name: Mapped[str] = mapped_column(String(128), default="unknown")
    audio_device_index: Mapped[int] = mapped_column(Integer, default=-1)
    audio_device_name: Mapped[str] = mapped_column(String(256), default="")
    stt_mode: Mapped[str] = mapped_column(String(16), default="auto")
    llm_mode: Mapped[str] = mapped_column(String(16), default="auto")
    total_segments: Mapped[int] = mapped_column(Integer, default=0)
    fraud_count: Mapped[int] = mapped_column(Integer, default=0)
    suspicious_count: Mapped[int] = mapped_column(Integer, default=0)
    clear_count: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)

    segments: Mapped[List["Segment"]] = relationship("Segment", back_populates="session")
    continuous_recordings: Mapped[List["ContinuousRecording"]] = relationship("ContinuousRecording", back_populates="session", cascade="all, delete-orphan")


# ─────────────────────────────────────────────────────────
# Segments (every STT+LLM cycle)
# ─────────────────────────────────────────────────────────

class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("recording_sessions.id"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    audio_duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    transcript: Mapped[str] = mapped_column(Text, default="")

    # Classification
    verdict: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    risk_level: Mapped[str] = mapped_column(String(16), default="low")
    reason: Mapped[str] = mapped_column(Text, default="")
    fraud_flags: Mapped[Optional[Dict]] = mapped_column(JSON, nullable=True)
    evidence: Mapped[Optional[List]] = mapped_column(JSON, nullable=True)

    # Performance
    stt_ms: Mapped[int] = mapped_column(Integer, default=0)
    llm_ms: Mapped[int] = mapped_column(Integer, default=0)
    stt_mode_used: Mapped[str] = mapped_column(String(16), default="")
    llm_mode_used: Mapped[str] = mapped_column(String(16), default="")

    session: Mapped["RecordingSession"] = relationship("RecordingSession", back_populates="segments")
    alert: Mapped[Optional["Alert"]] = relationship("Alert", back_populates="segment", uselist=False)


# ─────────────────────────────────────────────────────────
# Alerts (FRAUD / SUSPICIOUS only)
# ─────────────────────────────────────────────────────────

class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    segment_id: Mapped[int] = mapped_column(Integer, ForeignKey("segments.id"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # Denormalized for fast queries
    verdict: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    risk_level: Mapped[str] = mapped_column(String(16), default="low")
    reason: Mapped[str] = mapped_column(Text, default="")
    flags: Mapped[Optional[List]] = mapped_column(JSON, nullable=True)
    evidence: Mapped[Optional[List]] = mapped_column(JSON, nullable=True)
    transcript: Mapped[str] = mapped_column(Text, default="")

    # Recording
    recording_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    recording_filename: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    recording_duration_s: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pre_buffer_s: Mapped[float] = mapped_column(Float, default=10.0)
    post_buffer_s: Mapped[float] = mapped_column(Float, default=15.0)
    recording_ready: Mapped[bool] = mapped_column(Boolean, default=False)

    # External integrations
    audio_upload_id: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    audio_upload_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    mqtt_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    mqtt_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    segment: Mapped["Segment"] = relationship("Segment", back_populates="alert")


# ─────────────────────────────────────────────────────────
# Continuous Recordings
# ─────────────────────────────────────────────────────────

class ContinuousRecording(Base):
    __tablename__ = "continuous_recordings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("recording_sessions.id"), nullable=False)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    filepath: Mapped[str] = mapped_column(String(512), nullable=False)
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    duration_s: Mapped[float] = mapped_column(Float, nullable=False)

    session: Mapped["RecordingSession"] = relationship("RecordingSession", back_populates="continuous_recordings")

