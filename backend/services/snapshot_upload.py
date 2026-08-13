"""
snapshot_upload.py — Upload camera snapshot image file to external Cloud API.

Flow:
  1. POST multipart/form-data with snapshot image file to configured URL
  2. Send form-data text field 'category' (default 'detections')
  3. Parse response JSON to extract unique snapshot ID
  4. Return unique ID string

Config keys (from RuntimeConfig):
  - snapshot_upload_enabled
  - snapshot_upload_url
  - snapshot_upload_api_key
  - snapshot_upload_category
  - snapshot_upload_id_path (e.g. "id" or "data.id")
  - snapshot_upload_timeout
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


class SnapshotUploadService:
    def __init__(self, runtime_config):
        self._rc = runtime_config

    def upload(self, file_path: str) -> Optional[str]:
        """
        Upload snapshot image file to configured API endpoint.
        Returns unique ID from response, or None on failure.
        """
        url = self._rc.get("snapshot_upload_url", "")
        if not url:
            logger.warning("[SnapshotUpload] No upload URL configured")
            return None

        api_key = self._rc.get("snapshot_upload_api_key", "")
        timeout = int(self._rc.get("snapshot_upload_timeout", 30))
        id_path = self._rc.get("snapshot_upload_id_path", "id")
        category = self._rc.get("snapshot_upload_category", "detections")

        path = Path(file_path)
        if not path.exists():
            logger.error(f"[SnapshotUpload] File not found: {file_path}")
            return None

        data_fields = {"category": category} if category else {}

        headers = {}
        if api_key:
            if api_key.startswith("Bearer "):
                headers["Authorization"] = api_key
            else:
                headers["Authorization"] = f"Bearer {api_key}"
                headers["x-api-key"] = api_key

        try:
            with open(path, "rb") as f:
                mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
                files = {"file": (path.name, f, mime)}
                with httpx.Client(timeout=timeout) as client:
                    resp = client.post(url, files=files, data=data_fields, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()

            unique_id = _extract_by_path(data, id_path)
            if not unique_id:
                # Smart fallback for nested response structures e.g. data.id
                for alt_path in ["data.id", "id", "data.file_id", "file_id"]:
                    unique_id = _extract_by_path(data, alt_path)
                    if unique_id:
                        logger.info(f"[SnapshotUpload] Extracted ID using fallback path '{alt_path}': {unique_id}")
                        break

            if unique_id:
                logger.info(f"[SnapshotUpload] Uploaded {path.name} → snapshot_id={unique_id}")
                return unique_id
            else:
                logger.warning(f"[SnapshotUpload] ID not found at path '{id_path}' in response: {data}")
                return None

        except httpx.HTTPStatusError as e:
            logger.error(f"[SnapshotUpload] HTTP error {e.response.status_code}: {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"[SnapshotUpload] Error: {e}")
            return None
