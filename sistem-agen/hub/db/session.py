"""Database engine and session management with SQLite WAL mode."""

import os
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from hub.db.base import Base

APP_DIR = Path(__file__).resolve().parent.parent.parent
DEFAULT_DATA_DIR = APP_DIR / "data"
DEFAULT_DB_FILE = DEFAULT_DATA_DIR / "hub.db"
DEFAULT_DB_URL = f"sqlite:///{DEFAULT_DB_FILE}"

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATABASE_URL = DEFAULT_DB_URL

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)


@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode, foreign keys, and timeout on SQLite connections."""
    if hasattr(dbapi_connection, "cursor"):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=5000")
        except Exception:
            pass
        finally:
            cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db(target_engine=engine):
    """Create all tables defined in metadata."""
    Base.metadata.create_all(bind=target_engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
