"""
db_writer.py — Synchronous DB operations for pipeline threads.

Pipeline threads cannot use async SQLAlchemy directly.
This module uses a sync SQLAlchemy session for DB writes from threads.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from config import get_settings
from models import Alert, ConfigEntry, RecordingSession, Segment, ContinuousRecording

logger = logging.getLogger(__name__)


class DBWriter:
    """Sync SQLAlchemy session factory for use in background threads."""

    def __init__(self):
        settings = get_settings()
        db_path = Path(settings.database_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        db_url = f"sqlite:///{db_path}"
        self._engine = create_engine(
            db_url,
            connect_args={"check_same_thread": False},
            echo=False,
        )
        self._Session = sessionmaker(bind=self._engine)

    def _session(self) -> Session:
        return self._Session()

    # ──────────────────────────────────────────────────────
    # Session
    # ──────────────────────────────────────────────────────

    def create_session(
        self,
        device_name: str,
        audio_device_index: int,
        stt_mode: str,
        llm_mode: str,
    ) -> int:
        with self._session() as s:
            session = RecordingSession(
                start_time=datetime.now(timezone.utc),
                device_name=device_name,
                audio_device_index=audio_device_index,
                stt_mode=stt_mode,
                llm_mode=llm_mode,
            )
            s.add(session)
            s.commit()
            return session.id

    def close_session(self, session_id: int, stats: dict) -> None:
        with self._session() as s:
            session = s.get(RecordingSession, session_id)
            if session:
                session.end_time = datetime.now(timezone.utc)
                session.fraud_count = stats.get("FRAUD", 0)
                session.suspicious_count = stats.get("SUSPICIOUS", 0)
                session.clear_count = stats.get("NORMAL", 0)
                session.error_count = stats.get("ERROR", 0)
                session.total_segments = sum(stats.values())
                s.commit()

    # ──────────────────────────────────────────────────────
    # Segments
    # ──────────────────────────────────────────────────────

    def save_segment(
        self,
        session_id: int,
        timestamp: datetime,
        transcript: str,
        duration_s: float,
        fraud_result,
        stt_ms: int,
        llm_ms: int,
        stt_mode: str,
        llm_mode: str,
    ) -> int:
        with self._session() as s:
            seg = Segment(
                session_id=session_id,
                timestamp=timestamp,
                transcript=transcript,
                audio_duration_s=duration_s,
                verdict=fraud_result.verdict,
                confidence=fraud_result.confidence,
                risk_level=fraud_result.risk_level,
                reason=fraud_result.reason,
                fraud_flags=fraud_result.fraud_flags,
                evidence=fraud_result.evidence,
                stt_ms=stt_ms,
                llm_ms=llm_ms,
                stt_mode_used=stt_mode,
                llm_mode_used=llm_mode,
            )
            s.add(seg)
            s.commit()
            return seg.id

    # ──────────────────────────────────────────────────────
    # Alerts
    # ──────────────────────────────────────────────────────

    def save_alert(
        self,
        segment_id: int,
        session_id: int,
        timestamp: datetime,
        fraud_result,
        transcript: str,
        pre_buffer_s: float,
        post_buffer_s: float,
    ) -> int:
        with self._session() as s:
            alert = Alert(
                segment_id=segment_id,
                session_id=session_id,
                timestamp=timestamp,
                verdict=fraud_result.verdict,
                confidence=fraud_result.confidence,
                risk_level=fraud_result.risk_level,
                reason=fraud_result.reason,
                flags=fraud_result.active_flags,
                evidence=fraud_result.evidence,
                transcript=transcript,
                pre_buffer_s=pre_buffer_s,
                post_buffer_s=post_buffer_s,
            )
            s.add(alert)
            s.commit()
            return alert.id

    def update_alert_recording(self, alert_id: int, recording_info: dict) -> None:
        with self._session() as s:
            alert = s.get(Alert, alert_id)
            if alert:
                alert.recording_path = recording_info["path"]
                alert.recording_filename = recording_info["filename"]
                alert.recording_duration_s = recording_info["duration_s"]
                alert.recording_ready = True
                s.commit()

    def update_alert_upload_id(self, alert_id: int, upload_id: str) -> None:
        with self._session() as s:
            alert = s.get(Alert, alert_id)
            if alert:
                alert.audio_upload_id = upload_id
                alert.audio_upload_sent = True
                s.commit()

    def mark_mqtt_sent(self, alert_id: int) -> None:
        with self._session() as s:
            alert = s.get(Alert, alert_id)
            if alert:
                alert.mqtt_sent = True
                alert.mqtt_sent_at = datetime.now(timezone.utc)
                s.commit()

    def get_alert(self, alert_id: int) -> Optional[dict]:
        with self._session() as s:
            alert = s.get(Alert, alert_id)
            if alert:
                return {"transcript": alert.transcript}
        return None

    def save_continuous_recording(
        self,
        session_id: int,
        start_time: datetime,
        end_time: datetime,
        filepath: str,
        filename: str,
        duration_s: float,
    ) -> int:
        with self._session() as s:
            rec = ContinuousRecording(
                session_id=session_id,
                start_time=start_time,
                end_time=end_time,
                filepath=filepath,
                filename=filename,
                duration_s=duration_s,
            )
            s.add(rec)
            s.commit()
            return rec.id

    def delete_old_records(self, cutoff: datetime) -> dict:
        with self._session() as s:
            from sqlalchemy import delete
            # Delete old continuous recordings
            r_c = s.execute(delete(ContinuousRecording).where(ContinuousRecording.start_time < cutoff))
            # Delete old alerts first (foreign key)
            r_a = s.execute(delete(Alert).where(Alert.timestamp < cutoff))
            r_s = s.execute(delete(Segment).where(Segment.timestamp < cutoff))
            s.commit()
            return {
                "continuous_deleted": r_c.rowcount,
                "alerts_deleted": r_a.rowcount,
                "segments_deleted": r_s.rowcount,
            }
