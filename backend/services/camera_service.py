"""
services/camera_service.py — Camera Snapshot Capture Service for VoiceGuard.

Supports 3 snapshot sources:
1. ProtectQube AI Engine API endpoint (GET/POST to protectqube backend)
2. Direct RTSP Stream capture (using OpenCV Frame Grab)
3. Direct HTTP Snapshot URL (GET request to IP camera)
"""

import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

try:
    import cv2
except ImportError:
    cv2 = None

import urllib.request
import logging

logger = logging.getLogger(__name__)


class CameraSnapshotService:
    def __init__(self, storage_path: str = "/app/storage"):
        self.storage_path = Path(storage_path)
        self.snapshots_dir = self.storage_path / "snapshots"
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)

    def capture_snapshot(
        self,
        counter_info: Dict[str, Any],
        source: str = "protectqube",
        protectqube_url: str = "http://localhost:8000",
        timeout: int = 5,
        verdict: str = "ALERT",
    ) -> Optional[str]:
        """
        Captures a snapshot based on source mode and counter configuration.
        Returns the relative path e.g. 'snapshots/snap_counter1_171234567.jpg' or None if failed.
        """
        counter_id = counter_info.get("id", "default")
        camera_id = counter_info.get("camera_id") or counter_id
        rtsp_url = counter_info.get("rtsp_url")
        snapshot_url = counter_info.get("snapshot_url")

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:19]
        filename = f"snap_{counter_id}_{verdict}_{timestamp_str}.jpg"
        save_path = self.snapshots_dir / filename

        img_bytes = None

        try:
            if source == "protectqube":
                img_bytes = self._fetch_protectqube_snapshot(
                    protectqube_url, camera_id, timeout
                )
            elif source == "rtsp" and rtsp_url:
                img_bytes = self._fetch_rtsp_snapshot(rtsp_url, timeout)
            elif source == "http" and snapshot_url:
                img_bytes = self._fetch_http_snapshot(snapshot_url, timeout)
            else:
                # Fallback attempts: try ProtectQube first, then snapshot_url, then rtsp_url
                if camera_id:
                    img_bytes = self._fetch_protectqube_snapshot(
                        protectqube_url, camera_id, timeout
                    )
                if not img_bytes and snapshot_url:
                    img_bytes = self._fetch_http_snapshot(snapshot_url, timeout)
                if not img_bytes and rtsp_url:
                    img_bytes = self._fetch_rtsp_snapshot(rtsp_url, timeout)

            if img_bytes:
                with open(save_path, "wb") as f:
                    f.write(img_bytes)
                rel_path = f"snapshots/{filename}"
                logger.info(f"[CameraService] Saved snapshot for {counter_id} ({verdict}) -> {rel_path}")
                return rel_path
            else:
                logger.warning(f"[CameraService] Failed to capture snapshot for {counter_id} (source={source})")
                return None
        except Exception as e:
            logger.error(f"[CameraService] Error capturing snapshot for {counter_id}: {e}")
            return None

    def _fetch_protectqube_snapshot(
        self, base_url: str, camera_id: str, timeout: int
    ) -> Optional[bytes]:
        """Fetch snapshot image from ProtectQube AI backend API."""
        base_clean = base_url.rstrip("/")
        urls = [
            f"{base_clean}/api/cameras/{camera_id}/snapshot",
            f"{base_clean}/api/snapshots/latest?camera_id={camera_id}",
            f"{base_clean}/api/camera/{camera_id}/frame",
        ]
        for url in urls:
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": "VoiceGuard-Camera-Service"}
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    if resp.status == 200:
                        data = resp.read()
                        if len(data) > 1000:  # Valid image byte stream
                            return data
            except Exception:
                continue
        return None

    def _fetch_http_snapshot(self, snapshot_url: str, timeout: int) -> Optional[bytes]:
        """Fetch snapshot directly from HTTP Camera snapshot URL."""
        try:
            req = urllib.request.Request(
                snapshot_url, headers={"User-Agent": "VoiceGuard-Camera-Service"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    data = resp.read()
                    if len(data) > 1000:
                        return data
        except Exception as e:
            logger.error(f"[CameraService] HTTP snapshot fetch failed ({snapshot_url}): {e}")
        return None

    def _fetch_rtsp_snapshot(self, rtsp_url: str, timeout: int) -> Optional[bytes]:
        """Capture a single frame from RTSP stream using OpenCV."""
        if cv2 is None:
            logger.warning("[CameraService] OpenCV (cv2) is not available for RTSP capture")
            return None
        cap = None
        try:
            cap = cv2.VideoCapture(rtsp_url)
            if not cap.isOpened():
                return None
            ret, frame = cap.read()
            if ret and frame is not None:
                ret_encode, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                if ret_encode:
                    return buf.tobytes()
        except Exception as e:
            logger.error(f"[CameraService] RTSP frame grab failed ({rtsp_url}): {e}")
        finally:
            if cap:
                cap.release()
        return None
