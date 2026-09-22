"""
services/camera_service.py — Camera Snapshot, Video Capture & Spatial Presence Service for VoiceGuard.

Supports:
1. ProtectQube AI Engine API endpoint (GET /api/spatial/status, GET /api/cameras/{id}/snapshot, GET /api/cameras/{id}/clip)
2. Direct RTSP Stream capture & video recording (using OpenCV Frame Grab / VideoWriter)
3. Direct HTTP Snapshot URL (GET request to IP camera)
"""

import os
import re
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
import urllib.parse
import logging

logger = logging.getLogger(__name__)


def _get_candidate_bases(protectqube_url: str, working_base: Optional[str] = None) -> list[str]:
    """
    Builds an ordered list of candidate base URLs to query ProtectQube AI.

    Strategy:
    1. Last known working base (fastest path on repeated calls)
    2. The URL exactly as configured by the user — this is the most important one
    3. Same host with alternate ports (8082, 8012, 8000)
    4. Short fallback: 127.0.0.1 variants (same-machine scenario)

    Keeps the list short so failures are fast and logs are clean.
    """
    candidates: list[str] = []

    def _add(url: str) -> None:
        if url and url not in candidates:
            candidates.append(url)

    # 1. Last known working base
    if working_base:
        _add(working_base)

    # 2. Configured URL (exactly as user entered — highest priority)
    base_clean = (protectqube_url or "http://localhost:8082").rstrip("/")
    _add(base_clean)

    # 3. Same host, alternate ports
    host_match = re.match(r'^(https?://[^:/]+)', base_clean)
    if host_match:
        host_part = host_match.group(1)
        for port in ["8082", "8012", "8000"]:
            _add(f"{host_part}:{port}")

    # 4. Localhost fallback (same machine / host-network scenario)
    for h in ["127.0.0.1", "localhost"]:
        for port in ["8082", "8012", "8000"]:
            _add(f"http://{h}:{port}")

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
        logger.debug(f"[CameraService] Spatial check for {cache_key} — configured URL: {protectqube_url!r} — will try: {candidate_bases[:3]}")

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
    ) -> Dict[str, Optional[str]]:
        """
        Captures snapshot(s) based on source mode ('protectqube', 'rtsp', 'http', 'hybrid'/'both').
        Returns dict: {'snapshot_path': rel_path, 'snapshot_bbox_path': rel_bbox_path}.
        """
        counter_id = counter_info.get("id", "default")
        camera_id = counter_info.get("camera_id") or counter_id
        rtsp_url = counter_info.get("rtsp_url")
        snapshot_url = counter_info.get("snapshot_url")

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:19]
        base_filename = f"snap_{counter_id}_{verdict}_{timestamp_str}"

        clean_path_rel = None
        bbox_path_rel = None

        try:
            if source in ("hybrid", "both"):
                # 1. Fetch clean frame from RTSP / HTTP
                clean_bytes = None
                if rtsp_url:
                    clean_bytes = self._fetch_rtsp_snapshot(rtsp_url, timeout)
                if not clean_bytes and snapshot_url:
                    clean_bytes = self._fetch_http_snapshot(snapshot_url, timeout)

                # 2. Fetch AI Bounding Box frame from ProtectQube AI
                bbox_bytes = None
                if camera_id:
                    bbox_bytes = self._fetch_protectqube_snapshot(
                        protectqube_url, camera_id, timeout
                    )

                # Save clean snapshot
                if clean_bytes:
                    clean_file = f"{base_filename}.jpg"
                    with open(self.snapshots_dir / clean_file, "wb") as f:
                        f.write(clean_bytes)
                    clean_path_rel = f"snapshots/{clean_file}"

                # Save bbox snapshot
                if bbox_bytes:
                    bbox_file = f"{base_filename}_bbox.jpg"
                    with open(self.snapshots_dir / bbox_file, "wb") as f:
                        f.write(bbox_bytes)
                    bbox_path_rel = f"snapshots/{bbox_file}"

                # If clean wasn't available, use bbox as primary clean
                if not clean_path_rel and bbox_path_rel:
                    clean_path_rel = bbox_path_rel

                logger.info(f"[CameraService] Hybrid snapshot captured for {counter_id}: clean={clean_path_rel}, bbox={bbox_path_rel}")
                return {
                    "snapshot_path": clean_path_rel,
                    "snapshot_bbox_path": bbox_path_rel,
                }

            elif source == "protectqube":
                img_bytes = self._fetch_protectqube_snapshot(
                    protectqube_url, camera_id, timeout
                )
                if img_bytes:
                    filename = f"{base_filename}.jpg"
                    with open(self.snapshots_dir / filename, "wb") as f:
                        f.write(img_bytes)
                    rel_path = f"snapshots/{filename}"
                    logger.info(f"[CameraService] Saved ProtectQube snapshot for {counter_id} ({verdict}) -> {rel_path}")
                    return {"snapshot_path": rel_path, "snapshot_bbox_path": rel_path}

            elif source == "rtsp" and rtsp_url:
                img_bytes = self._fetch_rtsp_snapshot(rtsp_url, timeout)
                if img_bytes:
                    filename = f"{base_filename}.jpg"
                    with open(self.snapshots_dir / filename, "wb") as f:
                        f.write(img_bytes)
                    rel_path = f"snapshots/{filename}"
                    logger.info(f"[CameraService] Saved RTSP snapshot for {counter_id} ({verdict}) -> {rel_path}")
                    return {"snapshot_path": rel_path, "snapshot_bbox_path": None}

            elif source == "http" and snapshot_url:
                img_bytes = self._fetch_http_snapshot(snapshot_url, timeout)
                if img_bytes:
                    filename = f"{base_filename}.jpg"
                    with open(self.snapshots_dir / filename, "wb") as f:
                        f.write(img_bytes)
                    rel_path = f"snapshots/{filename}"
                    logger.info(f"[CameraService] Saved HTTP snapshot for {counter_id} ({verdict}) -> {rel_path}")
                    return {"snapshot_path": rel_path, "snapshot_bbox_path": None}

            else:
                # Fallback attempts
                img_bytes = None
                if camera_id:
                    img_bytes = self._fetch_protectqube_snapshot(
                        protectqube_url, camera_id, timeout
                    )
                if not img_bytes and snapshot_url:
                    img_bytes = self._fetch_http_snapshot(snapshot_url, timeout)
                if not img_bytes and rtsp_url:
                    img_bytes = self._fetch_rtsp_snapshot(rtsp_url, timeout)

                if img_bytes:
                    filename = f"{base_filename}.jpg"
                    with open(self.snapshots_dir / filename, "wb") as f:
                        f.write(img_bytes)
                    rel_path = f"snapshots/{filename}"
                    logger.info(f"[CameraService] Saved fallback snapshot for {counter_id} ({verdict}) -> {rel_path}")
                    return {"snapshot_path": rel_path, "snapshot_bbox_path": None}

            logger.warning(f"[CameraService] Failed to capture snapshot for {counter_id} (source={source})")
            return {"snapshot_path": None, "snapshot_bbox_path": None}

        except Exception as e:
            logger.error(f"[CameraService] Error capturing snapshot for {counter_id}: {e}")
            return {"snapshot_path": None, "snapshot_bbox_path": None}

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

        # Try browser-compatible H.264 codecs first (avc1/H264/X264), fallback to mp4v
        fourcc = None
        for codec_str in ["avc1", "H264", "X264", "mp4v"]:
            try:
                code = cv2.VideoWriter_fourcc(*codec_str)
                test_path = output_path + ".test"
                test_writer = cv2.VideoWriter(test_path, code, fps, (width, height))
                if test_writer.isOpened():
                    fourcc = code
                    test_writer.release()
                    if os.path.exists(test_path):
                        os.remove(test_path)
                    break
                if os.path.exists(test_path):
                    os.remove(test_path)
            except Exception:
                pass

        if fourcc is None:
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

        if frame_count > 0 and os.path.exists(output_path):
            convert_video_to_h264(output_path)

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


def convert_video_to_h264(file_path: os.PathLike | str) -> bool:
    """Converts a video file to HTML5 browser-compatible H.264 (libx264, yuv420p, +faststart)."""
    path = Path(file_path)
    if not path.exists() or path.stat().st_size < 1000:
        return False

    marker_file = path.with_suffix(path.suffix + ".h264ok")
    if marker_file.exists():
        return True

    tmp_out = path.with_suffix(".tmp_h264.mp4")
    try:
        import subprocess
        res = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(path),
                "-vcodec", "libx264", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                "-profile:v", "baseline", "-level", "3.0",
                str(tmp_out)
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=25
        )
        if res.returncode == 0 and tmp_out.exists() and tmp_out.stat().st_size > 1000:
            tmp_out.replace(path)
            try:
                marker_file.touch()
            except Exception:
                pass
            logger.info(f"[CameraService] Converted video clip to HTML5 H.264 -> {path.name}")
            return True
        elif tmp_out.exists():
            tmp_out.unlink()
    except Exception as e:
        logger.debug(f"[CameraService] Video H.264 conversion omitted/failed: {e}")
        if tmp_out.exists():
            try:
                tmp_out.unlink()
            except Exception:
                pass

    return False


def convert_all_existing_videos(videos_dir: os.PathLike | str) -> None:
    """Scans videos directory and converts all existing MP4 clips to H.264."""
    vdir = Path(videos_dir)
    if not vdir.exists():
        return
    for vf in vdir.glob("*.mp4"):
        if not vf.name.endswith(".tmp_h264.mp4") and not vf.name.endswith(".h264.mp4"):
            convert_video_to_h264(vf)


# Alias for concise import
CameraService = CameraSnapshotService

