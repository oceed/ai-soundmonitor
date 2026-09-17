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


@router.get("/spatial-status")
async def get_counters_spatial_status(
    _: User = Depends(get_current_user),
):
    """
    Returns real-time customer presence and desk status for all configured counters.
    Polled by Dashboard to display live 'Customer Present' vs 'Desk Empty' indicators.
    """
    import asyncio
    from config import runtime_config
    from services.camera_service import CameraService

    cam_svc = CameraService()
    counters = runtime_config.get("counters", [])
    if not counters:
        counters = [{"id": "default", "name": "Default Counter"}]
    protectqube_url = runtime_config.get("camera_snapshot_protectqube_url", "http://localhost:8012")
    tol_sec = float(runtime_config.get("spatial_customer_tolerance_seconds", 8.0))
    spatial_enabled = bool(runtime_config.get("spatial_customer_filter_enabled", False))

    loop = asyncio.get_running_loop()

    def _probe_all():
        results = {}
        for c in counters:
            c_id = c.get("id")
            if not c_id:
                continue
            cam_id = str(c.get("camera_id") or runtime_config.get("camera_snapshot_camera_id") or "").strip()
            if not cam_id:
                results[c_id] = {
                    "customer_present": None,
                    "camera_id": "",
                    "zone_id": "",
                    "spatial_enabled": spatial_enabled,
                    "error": "No camera linked to counter",
                }
                continue

            counter_copy = dict(c)
            counter_copy["camera_id"] = cam_id
            is_present = cam_svc.check_customer_presence(
                counter_info=counter_copy,
                protectqube_url=protectqube_url,
                tolerance_seconds=tol_sec,
                timeout=2,
            )
            results[c_id] = {
                "customer_present": is_present,
                "camera_id": cam_id,
                "zone_id": c.get("zone_id", ""),
                "spatial_enabled": spatial_enabled,
            }
        return results

    res = await loop.run_in_executor(None, _probe_all)
    return {"counters": res}
