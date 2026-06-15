"""
devices.py — List available audio input devices.

GET /api/devices/audio  → list of {index, name, channels, sample_rate}
"""

from fastapi import APIRouter, Depends

from api.auth import get_current_user
from pipeline.audio_capture import AudioCapture
from models import User

router = APIRouter(prefix="/api/devices", tags=["devices"])


@router.get("/audio")
async def list_audio_devices(
    _: User = Depends(get_current_user),
):
    """List available audio input devices on the host."""
    import asyncio
    loop = asyncio.get_running_loop()
    devices = await loop.run_in_executor(None, AudioCapture.list_devices)
    return {"devices": devices, "total": len(devices)}
