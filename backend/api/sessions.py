"""
sessions.py — Recording session stats.

GET /api/sessions          → list sessions
GET /api/sessions/current  → current session stats
GET /api/sessions/{id}     → session detail
GET /api/segments          → list segments with filters
"""

from __future__ import annotations

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
    q = select(Segment).order_by(desc(Segment.timestamp))
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
                "timestamp": s.timestamp.isoformat() if s.timestamp else None,
                "transcript": s.transcript,
                "verdict": s.verdict,
                "confidence": s.confidence,
                "risk_level": s.risk_level,
                "reason": s.reason,
                "stt_ms": s.stt_ms,
                "llm_ms": s.llm_ms,
                "stt_mode": s.stt_mode_used,
                "llm_mode": s.llm_mode_used,
            }
            for s in segments
        ]
    }


def _session_to_dict(s: RecordingSession) -> dict:
    return {
        "id": s.id,
        "start_time": s.start_time.isoformat() if s.start_time else None,
        "end_time": s.end_time.isoformat() if s.end_time else None,
        "device_name": s.device_name,
        "stt_mode": s.stt_mode,
        "llm_mode": s.llm_mode,
        "total_segments": s.total_segments,
        "fraud_count": s.fraud_count,
        "suspicious_count": s.suspicious_count,
        "clear_count": s.clear_count,
        "error_count": s.error_count,
    }
