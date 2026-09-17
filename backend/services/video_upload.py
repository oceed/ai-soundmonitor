"""
video_upload.py — Upload alert video clip file to external Cloud API.

Flow:
  1. POST multipart/form-data with video file (MP4) to configured URL
  2. Send form-data text field 'category' (default 'detections') and 'type'='video'
  3. Parse response JSON to extract unique video ID
  4. Return unique ID string

Config keys (from RuntimeConfig):
  - video_upload_enabled
  - video_upload_url
  - video_upload_api_key
  - video_upload_category
  - video_upload_id_path (e.g. "id" or "data.id")
  - video_upload_timeout
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def _extract_by_path(data: dict, path: str) -> Optional[str]:
    """Extract nested value using dot-notation path. e.g. 'data.id'"""
    keys = path.split(".")
    val = data
    for k in keys:
        if isinstance(val, dict):
            val = val.get(k)
        else:
            return None
    return str(val) if val is not None else None


class VideoUploadService:
    def __init__(self, runtime_config):
        self._rc = runtime_config

    def upload(self, file_path: str) -> Optional[str]:
        """
        Upload alert video file to configured API endpoint.
        Returns unique ID from response, or None on failure.
        """
        if not self._rc.get("video_upload_enabled", False):
            return None

        url = self._rc.get("video_upload_url", "")
        if not url:
            logger.warning("[VideoUpload] No upload URL configured")
            return None

        api_key = self._rc.get("video_upload_api_key", "")
        timeout = int(self._rc.get("video_upload_timeout", 60))
        id_path = self._rc.get("video_upload_id_path", "data.id")
        category = self._rc.get("video_upload_category", "detections")

        path = Path(file_path)
        if not path.exists():
            logger.error(f"[VideoUpload] File not found: {file_path}")
            return None

        data_fields = {"category": category, "type": "video"} if category else {"type": "video"}

        headers = {}
        if api_key:
            if api_key.startswith("Bearer "):
                headers["Authorization"] = api_key
            else:
                headers["Authorization"] = f"Bearer {api_key}"
                headers["x-api-key"] = api_key

        try:
            with open(path, "rb") as f:
                mime = "video/mp4" if path.suffix.lower() == ".mp4" else "video/octet-stream"
                files = {"file": (path.name, f, mime)}
                with httpx.Client(timeout=timeout) as client:
                    resp = client.post(url, files=files, data=data_fields, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()

            unique_id = _extract_by_path(data, id_path)
            if not unique_id:
                # Smart fallback for nested response structures
                for alt_path in ["data.id", "id", "data.file_id", "file_id", "recording_id", "data.recording_id"]:
                    unique_id = _extract_by_path(data, alt_path)
                    if unique_id:
                        logger.info(f"[VideoUpload] Extracted ID using fallback path '{alt_path}': {unique_id}")
                        break

            if unique_id:
                logger.info(f"[VideoUpload] Uploaded {path.name} → video_id={unique_id}")
                return unique_id
            else:
                logger.warning(f"[VideoUpload] ID not found at path '{id_path}' in response: {data}")
                return None

        except httpx.HTTPStatusError as e:
            logger.error(f"[VideoUpload] HTTP error {e.response.status_code}: {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"[VideoUpload] Error: {e}")
            return None
