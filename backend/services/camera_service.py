"""
services/camera_service.py — Camera Snapshot, Video Capture & Spatial Presence Service for VoiceGuard.

Supports:
1. ProtectQube AI Engine API endpoint (GET /api/spatial/status, GET /api/cameras/{id}/snapshot, GET /api/cameras/{id}/clip)
2. Direct RTSP Stream capture & video recording (using OpenCV Frame Grab / VideoWriter)
3. Direct HTTP Snapshot URL (GET request to IP camera)
"""

import os
import time
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

try:
    import cv2
except ImportError:
    cv2 = None

import urllib.request
import socket
import logging

logger = logging.getLogger(__name__)


def _get_candidate_bases(protectqube_url: str, working_base: Optional[str] = None) -> list[str]:
    """
    Builds an ordered list of candidate URLs to query ProtectQube AI.
    Prioritizes known working base, then host LAN IP on port 8082, then localhost/docker bridges.
    """
    import re
    candidates = []

    if working_base and working_base not in candidates:
        candidates.append(working_base)

    base_clean = (protectqube_url or "http://localhost:8082").rstrip("/")

    # 1. Detect LAN IP of the host machine (e.g. 192.168.1.77 on Orange Pi)
    lan_ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
        s.close()
        if ip and ip not in ("127.0.0.1", "0.0.0.0"):
            lan_ips.append(ip)
    except Exception:
        pass

    for extra in ["172.17.0.1", "host.docker.internal"]:
        if extra not in lan_ips:
            lan_ips.append(extra)

    # Put host LAN IP on port 8082 first!
    for ip in lan_ips:
        for p in ["8082", "8012"]:
            cand = f"http://{ip}:{p}"
            if cand not in candidates:
                candidates.append(cand)

    # 2. Configured URL with port 8082/8012/8000
    if re.search(r':(8000|8012|8082)', base_clean):
        for p in ["8082", "8012", "8000"]:
            alt = re.sub(r':(8000|8012|8082)', f":{p}", base_clean)
            if alt not in candidates:
                candidates.append(alt)
    elif base_clean not in candidates:
        candidates.append(base_clean)

    # 3. Localhost and 127.0.0.1
    for h in ["localhost", "127.0.0.1"]:
        for p in ["8082", "8012", "8000"]:
            cand = f"http://{h}:{p}"
            if cand not in candidates:
                candidates.append(cand)

    return candidates


class CameraSnapshotService:
    def __init__(self, storage_path: str = "/app/storage"):
        self.storage_path = Path(storage_path)
        self.snapshots_dir = self.storage_path / "snapshots"
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)
        self.videos_dir = self.storage_path / "videos"
        self.videos_dir.mkdir(parents=True, exist_ok=True)
        self._last_customer_seen: Dict[str, float] = {}
        self._working_base: Optional[str] = None

    # ──────────────────────────────────────────────────────
    # Spatial Customer Presence Check
    # ──────────────────────────────────────────────────────

    def check_customer_presence(
        self,
        counter_info: Dict[str, Any],
        protectqube_url: str = "http://localhost:8082",
        tolerance_seconds: float = 8.0,
        timeout: int = 3,
    ) -> bool:
        """
        Queries ProtectQube AI for customer presence in Customer Service Zone.
        Supports multi-camera and per-zone filtering (counter_info['camera_id'] & optional counter_info['zone_id']).
        Returns True if customer is currently present or was seen within `tolerance_seconds`.
        """
        camera_id = counter_info.get("camera_id") or counter_info.get("id", "default")
        zone_id = counter_info.get("zone_id", "").strip() if counter_info.get("zone_id") else ""
        cache_key = f"{camera_id}_{zone_id}" if zone_id else camera_id
        now = time.monotonic()

        candidate_bases = _get_candidate_bases(protectqube_url, self._working_base)

        last_err = None
        for cand in candidate_bases:
            url = f"{cand}/api/spatial/status/{camera_id}"
            if zone_id:
                url += f"?zone_id={urllib.parse.quote(zone_id)}"

            try:
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "VoiceGuard-Spatial-Client"}
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    if resp.status == 200:
                        self._working_base = cand
                        data = json.loads(resp.read().decode("utf-8"))
                        is_present = bool(data.get("customer_present", False))
                        active_count = int(data.get("active_customers", 0))

                        if is_present or active_count > 0:
                            self._last_customer_seen[cache_key] = now
                            logger.info(f"[CameraService] Customer detected at {cache_key} (active: {active_count}) via {cand}")
                            return True
                        else:
                            # Successful response indicating no customer currently in zone
                            last_seen = self._last_customer_seen.get(cache_key, 0.0)
                            if (now - last_seen) <= tolerance_seconds and last_seen > 0:
                                logger.debug(f"[CameraService] Customer considered present within tolerance window ({now - last_seen:.1f}s ago)")
                                return True
                            return False
            except Exception as e:
                last_err = e

        if last_err:
            logger.warning(f"[CameraService] Spatial check failed for {cache_key} (tried {candidate_bases}): {last_err}")

        # Check tolerance window even if network query errored out
        last_seen = self._last_customer_seen.get(cache_key, 0.0)
        if (now - last_seen) <= tolerance_seconds and last_seen > 0:
            logger.debug(f"[CameraService] Customer considered present within tolerance window ({now - last_seen:.1f}s ago)")
            return True

        return False

    # ──────────────────────────────────────────────────────
    # Snapshot Capture
    # ──────────────────────────────────────────────────────

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
        Returns relative path e.g. 'snapshots/snap_counter1_171234567.jpg' or None if failed.
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
                # Fallback attempts
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

    # ──────────────────────────────────────────────────────
    # Video Clip Capture
    # ──────────────────────────────────────────────────────

    def capture_video_clip(
        self,
        counter_info: Dict[str, Any],
        duration_s: int = 10,
        source: str = "protectqube",
        protectqube_url: str = "http://localhost:8000",
        verdict: str = "ALERT",
    ) -> Optional[str]:
        """
        Captures a video clip (MP4).
        If source is 'protectqube', tries to fetch clip from ProtectQube API.
        If source is 'rtsp' or fallback, records directly from RTSP stream using OpenCV.
        Returns relative path e.g. 'videos/vid_counter1_ALERT_20260917_153000.mp4' or None.
        """
        counter_id = counter_info.get("id", "default")
        camera_id = counter_info.get("camera_id") or counter_id
        rtsp_url = counter_info.get("rtsp_url")

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"vid_{counter_id}_{verdict}_{timestamp_str}.mp4"
        save_path = self.videos_dir / filename

        # 1. Try ProtectQube API clip first if configured
        if source == "protectqube":
            try:
                bases = _get_candidate_bases(protectqube_url, self._working_base)
                for base_clean in bases:
                    try:
                        url = f"{base_clean}/api/cameras/{camera_id}/clip?duration={duration_s}"
                        req = urllib.request.Request(
                            url,
                            headers={"User-Agent": "VoiceGuard-Camera-Service"}
                        )
                        with urllib.request.urlopen(req, timeout=duration_s + 5) as resp:
                            if resp.status == 200:
                                data = resp.read()
                                if len(data) > 10000:  # Valid video stream
                                    with open(save_path, "wb") as f:
                                        f.write(data)
                                    rel_path = f"videos/{filename}"
                                    logger.info(f"[CameraService] Fetched video clip from ProtectQube -> {rel_path} ({len(data)} bytes)")
                                    return rel_path
                    except Exception:
                        continue
            except Exception as e:
                logger.debug(f"[CameraService] ProtectQube clip fetch failed ({camera_id}): {e}, attempting RTSP direct fallback")

        # 2. Direct RTSP recording via OpenCV
        if rtsp_url and cv2 is not None:
            try:
                rec_path = self._record_rtsp_clip(rtsp_url, str(save_path), duration_s=duration_s)
                if rec_path and os.path.exists(rec_path) and os.path.getsize(rec_path) > 1000:
                    rel_path = f"videos/{filename}"
                    logger.info(f"[CameraService] Recorded video clip from RTSP -> {rel_path}")
                    return rel_path
            except Exception as e:
                logger.error(f"[CameraService] Direct RTSP recording failed: {e}")

        logger.warning(f"[CameraService] No video clip captured for {counter_id}")
        return None

    def _record_rtsp_clip(self, rtsp_url: str, output_path: str, duration_s: int = 10, target_fps: int = 15) -> Optional[str]:
        """Record video clip directly from RTSP stream using OpenCV."""
        if cv2 is None:
            return None

        cap = cv2.VideoCapture(rtsp_url)
        if not cap.isOpened():
            logger.warning(f"[CameraService] Could not open RTSP stream: {rtsp_url}")
            return None

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        if fps <= 0 or fps > 60:
            fps = target_fps

        # MP4V codec for cross-platform compatibility
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

        max_frames = duration_s * fps
        frame_count = 0
        start_time = time.time()

        try:
            while frame_count < max_frames and (time.time() - start_time) < (duration_s + 3):
                ret, frame = cap.read()
                if not ret or frame is None:
                    break
                writer.write(frame)
                frame_count += 1
        finally:
            writer.release()
            cap.release()

        return output_path if frame_count > 0 else None

    # ──────────────────────────────────────────────────────
    # Snapshot Fetch Helpers
    # ──────────────────────────────────────────────────────

    def _fetch_protectqube_snapshot(
        self, base_url: str, camera_id: str, timeout: int
    ) -> Optional[bytes]:
        """Fetch snapshot image from ProtectQube AI backend API."""
        bases = _get_candidate_bases(base_url, self._working_base)
        for base_clean in bases:
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
                            if len(data) > 1000:
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


# Alias for concise import
CameraService = CameraSnapshotService
