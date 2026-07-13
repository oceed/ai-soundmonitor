"""
database.py — SQLAlchemy async engine + session factory.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import get_settings


def _get_db_url() -> str:
    settings = get_settings()
    db_path = Path(settings.database_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{db_path}"

from sqlalchemy import event

engine = create_async_engine(
    _get_db_url(),
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 5.0},
)


@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency — yields an async DB session."""
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create all tables on startup."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Self-healing migration for multi-counter support
    import sqlite3
    settings = get_settings()
    try:
        conn = sqlite3.connect(settings.database_path)
        cursor = conn.cursor()
        for table, col, col_type, default_val in [
            ("recording_sessions", "counter_id", "VARCHAR(64)", "default"),
            ("segments", "counter_id", "VARCHAR(64)", "default"),
            ("alerts", "counter_id", "VARCHAR(64)", "default"),
        ]:
            cursor.execute(f"PRAGMA table_info({table})")
            columns = [info[1] for info in cursor.fetchall()]
            if col not in columns:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type} DEFAULT '{default_val}'")
                print(f"[Migration] Added column {col} to table {table}")
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[Migration] Error applying SQLite migrations: {e}")

