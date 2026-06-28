"""
sessions.py — Recording session stats.

GET /api/sessions          → list sessions
GET /api/sessions/current  → current session stats
GET /api/sessions/{id}     → session detail
GET /api/segments          → list segments with filters
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from database import get_db
from models import RecordingSession, Segment, User

router = APIRouter(tags=["sessions"])


@router.get("/api/sessions")
async def list_sessions(
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(RecordingSession).order_by(desc(RecordingSession.start_time)).offset(skip).limit(limit)
    )
    sessions = result.scalars().all()
    return {"items": [_session_to_dict(s) for s in sessions]}


@router.get("/api/sessions/current")
async def get_current_session(
    _: User = Depends(get_current_user),
):
    from main import get_orchestrator
    orch = get_orchestrator()
    if orch:
        return {"running": orch.is_running, "stats": orch.stats}
    return {"running": False, "stats": {}}


@router.get("/api/sessions/{session_id}")
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(RecordingSession).where(RecordingSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _session_to_dict(session)


@router.get("/api/segments")
async def list_segments(
    session_id: Optional[int] = Query(None),
    verdict: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from sqlalchemy.orm import selectinload
    q = select(Segment).options(selectinload(Segment.alert)).order_by(desc(Segment.timestamp))
    if session_id:
        q = q.where(Segment.session_id == session_id)
    if verdict:
        q = q.where(Segment.verdict == verdict)
    result = await db.execute(q.offset(skip).limit(limit))
    segments = result.scalars().all()
    return {
        "items": [
            {
                "id": s.id,
                "session_id": s.session_id,
                "timestamp": s.timestamp.replace(tzinfo=timezone.utc).isoformat() if s.timestamp else None,
                "transcript": s.transcript,
                "verdict": s.verdict,
                "confidence": s.confidence,
                "risk_level": s.risk_level,
                "reason": s.reason,
                "flags": [k for k, v in s.fraud_flags.items() if v] if s.fraud_flags else [],
                "has_recording": bool(s.alert.recording_path and s.alert.recording_ready) if s.alert else False,
                "alert_id": s.alert.id if s.alert else None,
                "stt_ms": s.stt_ms,
                "llm_ms": s.llm_ms,
                "stt_mode": s.stt_mode_used,
                "llm_mode": s.llm_mode_used,
            }
            for s in segments
        ]
    }


@router.get("/api/analytics")
async def get_analytics(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select
    
    dt_from = None
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from)
            if dt_from.tzinfo is not None:
                dt_from = dt_from.astimezone(timezone.utc).replace(tzinfo=None)
        except ValueError:
            pass

    dt_to = None
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to)
            if dt_to.tzinfo is not None:
                dt_to = dt_to.astimezone(timezone.utc).replace(tzinfo=None)
        except ValueError:
            pass

    q = select(Segment)
    if dt_from:
        q = q.where(Segment.timestamp >= dt_from)
    if dt_to:
        q = q.where(Segment.timestamp <= dt_to)
        
    result = await db.execute(q)
    segments = result.scalars().all()
    
    total_segments = len(segments)
    verdict_counts = {"FRAUD": 0, "SUSPICIOUS": 0, "NORMAL": 0}
    category_counts = {}
    daily_trend = {}
    
    for s in segments:
        verdict = s.verdict or "NORMAL"
        verdict_counts[verdict] = verdict_counts.get(verdict, 0) + 1
        
        if s.fraud_flags:
            for cat_key, active in s.fraud_flags.items():
                if active:
                    category_counts[cat_key] = category_counts.get(cat_key, 0) + 1
                    
        date_str = s.timestamp.strftime("%Y-%m-%d") if s.timestamp else "Unknown"
        if date_str not in daily_trend:
            daily_trend[date_str] = {
                "date": date_str,
                "total": 0,
                "fraud": 0,
                "suspicious": 0,
                "normal": 0,
            }
        daily_trend[date_str]["total"] += 1
        if verdict == "FRAUD":
            daily_trend[date_str]["fraud"] += 1
        elif verdict == "SUSPICIOUS":
            daily_trend[date_str]["suspicious"] += 1
        else:
            daily_trend[date_str]["normal"] += 1
            
    trend_list = []
    for d_str, day_data in sorted(daily_trend.items()):
        total = day_data["total"]
        non_compliant = day_data["fraud"] + day_data["suspicious"]
        score = max(0, round(((total - non_compliant) / total) * 100)) if total > 0 else 100
        day_data["sop_score"] = score
        trend_list.append(day_data)
        
    non_compliant_total = verdict_counts["FRAUD"] + verdict_counts["SUSPICIOUS"]
    overall_sop_score = max(0, round(((total_segments - non_compliant_total) / total_segments) * 100)) if total_segments > 0 else 100
    
    return {
        "total_segments": total_segments,
        "by_verdict": verdict_counts,
        "by_category": category_counts,
        "sop_score": overall_sop_score,
        "daily_trend": trend_list,
    }


def _session_to_dict(s: RecordingSession) -> dict:
    return {
        "id": s.id,
        "start_time": s.start_time.replace(tzinfo=timezone.utc).isoformat() if s.start_time else None,
        "end_time": s.end_time.replace(tzinfo=timezone.utc).isoformat() if s.end_time else None,
        "device_name": s.device_name,
        "stt_mode": s.stt_mode,
        "llm_mode": s.llm_mode,
        "total_segments": s.total_segments,
        "fraud_count": s.fraud_count,
        "suspicious_count": s.suspicious_count,
        "clear_count": s.clear_count,
        "error_count": s.error_count,
    }
