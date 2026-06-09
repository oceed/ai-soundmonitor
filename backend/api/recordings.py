"""
recordings.py — Serve audio recording files.

GET /api/recordings/{alert_id}/stream  → stream audio file
GET /api/recordings/{alert_id}/download → download with filename
GET /api/recordings/timeline?date=YYYY-MM-DD → timeline data
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from config import get_settings
from database import get_db
from models import Alert, User, ContinuousRecording, Segment

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


@router.get("/timeline")
async def get_timeline(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Returns all segments (both normal and alerts) for a given date.
    Used by NVR timeline to render markers.
    """
    from datetime import datetime, timezone, timedelta
    from sqlalchemy.orm import selectinload

    try:
        day_start = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    day_end = day_start + timedelta(days=1)

    result = await db.execute(
        select(Segment)
        .options(selectinload(Segment.alert))
        .where(Segment.timestamp >= day_start, Segment.timestamp < day_end)
        .order_by(Segment.timestamp)
    )
    segments = result.scalars().all()

    items = []
    for s in segments:
        items.append({
            "segment_id": s.id,
            "alert_id": s.alert.id if s.alert else None,
            "timestamp": s.timestamp.isoformat(),
            "verdict": s.verdict,
            "confidence": s.confidence,
            "risk_level": s.risk_level,
            "has_recording": bool(s.alert.recording_path and s.alert.recording_ready) if s.alert else False,
            "duration_s": s.audio_duration_s,
            "reason": s.reason,
            "transcript": s.transcript,
        })

    # Fetch continuous recordings for the day
    result_cont = await db.execute(
        select(ContinuousRecording)
        .where(ContinuousRecording.start_time >= day_start, ContinuousRecording.start_time < day_end)
        .order_by(ContinuousRecording.start_time)
    )
    conts = result_cont.scalars().all()

    cont_items = []
    for c in conts:
        cont_items.append({
            "id": c.id,
            "start_time": c.start_time.isoformat(),
            "end_time": c.end_time.isoformat(),
            "duration_s": c.duration_s,
            "filename": c.filename,
        })

    return {
        "date": date,
        "alerts": items,
        "continuous_recordings": cont_items,
        "total": len(items)
    }


@router.get("/{alert_id}/stream")
async def stream_recording(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    alert = await _get_alert_with_recording(alert_id, db)
    file_path = Path(alert.recording_path)

    media_type = "audio/ogg" if file_path.suffix == ".ogg" else "audio/wav"

    def iterfile():
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(
        iterfile(),
        media_type=media_type,
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_path.stat().st_size)},
    )


@router.get("/{alert_id}/download")
async def download_recording(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    alert = await _get_alert_with_recording(alert_id, db)
    file_path = Path(alert.recording_path)
    media_type = "audio/ogg" if file_path.suffix == ".ogg" else "audio/wav"
    filename = alert.recording_filename or file_path.name

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


async def _get_alert_with_recording(alert_id: int, db: AsyncSession) -> Alert:
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if not alert.recording_path or not alert.recording_ready:
        raise HTTPException(status_code=404, detail="Recording not available")
    path = Path(alert.recording_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Recording file not found on disk")
    return alert


@router.get("/continuous/{recording_id}/stream")
async def stream_continuous_recording(
    recording_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ContinuousRecording).where(ContinuousRecording.id == recording_id))
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Continuous recording not found")

    file_path = Path(rec.filepath)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    media_type = "audio/ogg" if file_path.suffix == ".ogg" else "audio/wav"

    def iterfile():
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(
        iterfile(),
        media_type=media_type,
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_path.stat().st_size)},
    )
