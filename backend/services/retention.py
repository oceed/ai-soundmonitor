"""
retention.py — APScheduler job for cleaning up old recordings, DB entries, and disk pressure protection.

Runs periodically. Deletes:
  - Audio files older than retention_days
  - Alert and Segment DB rows older than retention_days
  - Continuous recording files (FIFO) if disk usage exceeds max_disk_usage_percent or continuous_max_storage_gb
  - Empty date directories
"""

from __future__ import annotations

import logging
import shutil
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

        # 1. Delete old files based on retention days
        files_deleted = self._cleanup_files(cutoff)

        # 2. Delete old DB records
        db_result = self._db.delete_old_records(cutoff)

        # 3. Disk Pressure & Storage Quota Purge for Continuous Recordings (FIFO)
        pressure_deleted = self._cleanup_by_disk_pressure()

        result = {
            "cutoff": cutoff.isoformat(),
            "files_deleted": files_deleted,
            "pressure_deleted": pressure_deleted,
            **db_result,
        }
        logger.info(f"[Retention] Cleanup done: {result}")
        return result

    def _cleanup_by_disk_pressure(self) -> int:
        cont_dir = self._recordings_dir / "continuous"
        if not cont_dir.exists():
            return 0

        max_disk_pct = float(self._rc.get("max_disk_usage_percent", 85.0))
        max_quota_gb = float(self._rc.get("continuous_max_storage_gb", 15.0))
        max_quota_bytes = int(max_quota_gb * (1024 ** 3)) if max_quota_gb > 0 else 0

        # Check overall disk usage
        try:
            total, used, free = shutil.disk_usage(str(self._recordings_dir))
            current_disk_pct = (used / total) * 100.0
        except Exception as e:
            logger.error(f"[Retention] Failed to read disk usage: {e}")
            current_disk_pct = 0.0
            total, used = 1, 0

        # Collect continuous files
        cont_files = []
        total_cont_bytes = 0
        for f in cont_dir.rglob("*"):
            if f.is_file():
                try:
                    st = f.stat()
                    total_cont_bytes += st.st_size
                    cont_files.append((st.st_mtime, st.st_size, f))
                except OSError:
                    pass

        # Sort oldest first (FIFO)
        cont_files.sort(key=lambda x: x[0])

        needs_disk_purge = current_disk_pct >= max_disk_pct
        needs_quota_purge = (max_quota_bytes > 0) and (total_cont_bytes >= max_quota_bytes)

        if not needs_disk_purge and not needs_quota_purge:
            return 0

        logger.warning(
            f"[Retention] Continuous Storage Pressure Triggered! "
            f"Disk: {current_disk_pct:.1f}% (Limit: {max_disk_pct}%), "
            f"Continuous Size: {total_cont_bytes / (1024**3):.2f} GB (Quota: {max_quota_gb} GB). "
            f"Purging oldest continuous audio files..."
        )

        deleted_count = 0
        for mtime, fsize, fpath in cont_files:
            try:
                fpath.unlink()
                deleted_count += 1
                total_cont_bytes -= fsize
                used -= fsize
                current_disk_pct = (used / total) * 100.0

                safe_disk = current_disk_pct <= (max_disk_pct - 5.0)
                safe_quota = (max_quota_bytes <= 0) or (total_cont_bytes <= max_quota_bytes * 0.9)

                if safe_disk and safe_quota:
                    logger.info(f"[Retention] Disk pressure resolved. Deleted {deleted_count} oldest continuous recordings.")
                    break
            except OSError as ex:
                logger.error(f"[Retention] Error deleting {fpath}: {ex}")

        # Clean empty subdirs
        self._remove_empty_subdirs(cont_dir)
        return deleted_count

    def _remove_empty_subdirs(self, base_dir: Path):
        try:
            for d in list(base_dir.iterdir()):
                if d.is_dir():
                    try:
                        d.rmdir()
                    except OSError:
                        pass
        except Exception:
            pass

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
