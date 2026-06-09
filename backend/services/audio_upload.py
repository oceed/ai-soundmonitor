"""
audio_upload.py — Upload audio file to external API.

Flow:
  1. POST multipart/form-data with audio file to configured URL
  2. Parse response JSON to extract unique ID
  3. Return unique ID string

Config keys (from RuntimeConfig):
  - audio_upload_url
  - audio_upload_api_key
  - audio_upload_id_path  (e.g. "id" or "data.id")
  - audio_upload_timeout
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


class AudioUploadService:
    def __init__(self, runtime_config):
        self._rc = runtime_config

    def upload(self, file_path: str) -> Optional[str]:
        """
        Upload audio file to configured API endpoint.
        Returns unique ID from response, or None on failure.
        """
        url = self._rc.get("audio_upload_url", "")
        if not url:
            logger.warning("[AudioUpload] No upload URL configured")
            return None

        api_key = self._rc.get("audio_upload_api_key", "")
        timeout = int(self._rc.get("audio_upload_timeout", 30))
        id_path = self._rc.get("audio_upload_id_path", "id")

        path = Path(file_path)
        if not path.exists():
            logger.error(f"[AudioUpload] File not found: {file_path}")
            return None

        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            with open(path, "rb") as f:
                mime = "audio/ogg" if path.suffix == ".ogg" else "audio/wav"
                files = {"file": (path.name, f, mime)}
                with httpx.Client(timeout=timeout) as client:
                    resp = client.post(url, files=files, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()

            unique_id = _extract_by_path(data, id_path)
            if unique_id:
                logger.info(f"[AudioUpload] Uploaded {path.name} → id={unique_id}")
                return unique_id
            else:
                logger.warning(f"[AudioUpload] ID not found at path '{id_path}' in response: {data}")
                return None

        except httpx.HTTPStatusError as e:
            logger.error(f"[AudioUpload] HTTP error {e.response.status_code}: {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"[AudioUpload] Error: {e}")
            return None
