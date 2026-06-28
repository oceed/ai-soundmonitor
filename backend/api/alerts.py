"""
alerts.py — Alert CRUD API.

GET  /api/alerts          → list with filters
GET  /api/alerts/{id}     → single alert detail
DELETE /api/alerts/{id}   → delete alert + recording
GET  /api/alerts/stats    → aggregated stats
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from database import get_db
from models import Alert, Segment, User

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(
    verdict: Optional[str] = Query(None, description="Filter by verdict: FRAUD, SUSPICIOUS"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    session_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Alert).order_by(desc(Alert.timestamp))
    # Exclude NORMAL segment recordings from the Alerts panel list
    q = q.where(Alert.verdict != "NORMAL")

    if verdict:
        if verdict == "FRAUD":
            q = q.where(Alert.verdict == "FRAUD")
        else:
            q = q.where(Alert.verdict == verdict)

    if date_from:
        try:
            dt = datetime.fromisoformat(date_from)
            q = q.where(Alert.timestamp >= dt)
        except ValueError:
            pass

    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            q = q.where(Alert.timestamp <= dt)
        except ValueError:
            pass

    if session_id:
        q = q.where(Alert.session_id == session_id)

    # Count total
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    # Paginate
    result = await db.execute(q.offset(skip).limit(limit))
    alerts = result.scalars().all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [_alert_to_dict(a) for a in alerts],
    }


@router.get("/stats")
async def get_stats(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Alert)
    if date_from:
        try:
            q = q.where(Alert.timestamp >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.where(Alert.timestamp <= datetime.fromisoformat(date_to))
        except ValueError:
            pass

    result = await db.execute(q)
    alerts = result.scalars().all()

    verdict_counts = {}
    risk_counts = {}
    for a in alerts:
        verdict_counts[a.verdict] = verdict_counts.get(a.verdict, 0) + 1
        risk_counts[a.risk_level] = risk_counts.get(a.risk_level, 0) + 1

    return {
        "total": len(alerts),
        "by_verdict": verdict_counts,
        "by_risk": risk_counts,
    }


@router.get("/{alert_id}")
async def get_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return _alert_to_dict(alert)


@router.delete("/{alert_id}")
async def delete_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # Delete recording file
    if alert.recording_path:
        import os
        try:
            os.unlink(alert.recording_path)
        except OSError:
            pass

    await db.delete(alert)
    await db.commit()
    return {"message": "Alert deleted"}


def _alert_to_dict(a: Alert) -> dict:
    return {
        "id": a.id,
        "segment_id": a.segment_id,
        "session_id": a.session_id,
        "timestamp": a.timestamp.replace(tzinfo=timezone.utc).isoformat() if a.timestamp else None,
        "verdict": a.verdict,
        "classification": a.verdict,  # for compatibility
        "confidence": a.confidence,
        "risk_level": a.risk_level,
        "reason": a.reason,
        "flags": a.flags or [],
        "evidence": a.evidence or [],
        "transcript": a.transcript,
        "recording_path": a.recording_path,
        "recording_filename": a.recording_filename,
        "recording_duration_s": a.recording_duration_s,
        "recording_ready": a.recording_ready,
        "pre_buffer_s": a.pre_buffer_s,
        "post_buffer_s": a.post_buffer_s,
        "audio_upload_id": a.audio_upload_id,
        "audio_upload_sent": a.audio_upload_sent,
        "mqtt_sent": a.mqtt_sent,
        "mqtt_sent_at": a.mqtt_sent_at.replace(tzinfo=timezone.utc).isoformat() if a.mqtt_sent_at else None,
    }
