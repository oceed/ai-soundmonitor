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
from models import Alert, User

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


@router.get("/timeline")
async def get_timeline(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Returns all alerts with recordings for a given date.
    Used by NVR timeline to render markers.
    """
    from datetime import datetime, timezone, timedelta

    try:
        day_start = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    day_end = day_start + timedelta(days=1)

    result = await db.execute(
        select(Alert)
        .where(Alert.timestamp >= day_start, Alert.timestamp < day_end)
        .order_by(Alert.timestamp)
    )
    alerts = result.scalars().all()

    items = []
    for a in alerts:
        items.append({
            "alert_id": a.id,
            "timestamp": a.timestamp.isoformat(),
            "verdict": a.verdict,
            "confidence": a.confidence,
            "risk_level": a.risk_level,
            "has_recording": bool(a.recording_path and a.recording_ready),
            "duration_s": a.recording_duration_s,
            "reason": a.reason,
        })

    return {"date": date, "alerts": items, "total": len(items)}


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
