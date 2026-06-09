"""
retention.py — APScheduler job for cleaning up old recordings and DB entries.

Runs every 6 hours. Deletes:
  - Audio files older than retention_days
  - Alert and Segment DB rows older than retention_days
  - Empty date directories
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class RetentionService:
    def __init__(self, db_writer, recordings_dir: Path, runtime_config):
        self._db = db_writer
        self._recordings_dir = recordings_dir
        self._rc = runtime_config

    def run_cleanup(self) -> dict:
        retention_days = int(self._rc.get("retention_days", 7))
        cutoff = datetime.now(tz=timezone.utc) - timedelta(days=retention_days)
        logger.info(f"[Retention] Cleaning up data older than {cutoff.date()} ({retention_days} days)")

        # 1. Delete old files
        files_deleted = self._cleanup_files(cutoff)

        # 2. Delete old DB records
        db_result = self._db.delete_old_records(cutoff)

        result = {
            "cutoff": cutoff.isoformat(),
            "files_deleted": files_deleted,
            **db_result,
        }
        logger.info(f"[Retention] Cleanup done: {result}")
        return result

    def _cleanup_files(self, cutoff: datetime) -> int:
        count = 0
        if not self._recordings_dir.exists():
            return 0

        # Clean standard recordings dir
        count += self._cleanup_dir(self._recordings_dir, cutoff)

        # Clean continuous recordings dir
        cont_dir = self._recordings_dir / "continuous"
        if cont_dir.exists():
            count += self._cleanup_dir(cont_dir, cutoff)

        return count

    def _cleanup_dir(self, base_dir: Path, cutoff: datetime) -> int:
        count = 0
        for date_dir in base_dir.iterdir():
            if not date_dir.is_dir():
                continue
            try:
                dir_date = datetime.strptime(date_dir.name, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                if dir_date < cutoff:
                    for f in date_dir.iterdir():
                        if f.is_file():
                            f.unlink()
                            count += 1
                    # Remove empty directory
                    try:
                        date_dir.rmdir()
                    except OSError:
                        pass  # Not empty, leave it
            except ValueError:
                pass  # Non-date directory, skip

        return count
