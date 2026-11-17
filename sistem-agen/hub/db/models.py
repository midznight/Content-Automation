"""SQLAlchemy database models for Hub MCP."""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from hub.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def generate_uuid(prefix: str = "") -> str:
    short = uuid.uuid4().hex[:12]
    return f"{prefix}{short}" if prefix else short


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: generate_uuid("agt_")
    )
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    vendor: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: generate_uuid("vid_")
    )
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    pillar: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stage: Mapped[str] = mapped_column(String(32), default="topic", index=True, nullable=False)
    label_ai: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tiktok_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="video")
    artifacts: Mapped[list["Artifact"]] = relationship("Artifact", back_populates="video")
    approvals: Mapped[list["Approval"]] = relationship("Approval", back_populates="video")
    metrics: Mapped[list["Metric"]] = relationship("Metric", back_populates="video")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: generate_uuid("tsk_")
    )
    parent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("videos.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default="normal", nullable=False)
    from_agent: Mapped[str] = mapped_column(String(64), nullable=False)
    to_agent: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True, nullable=False)
    blocked_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    reassigned_from: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    video: Mapped[Video | None] = relationship("Video", back_populates="tasks")
    artifacts: Mapped[list["Artifact"]] = relationship("Artifact", back_populates="task")


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: generate_uuid("art_")
    )
    task_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("tasks.id"), nullable=True)
    video_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("videos.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    video: Mapped[Video | None] = relationship("Video", back_populates="artifacts")
    task: Mapped[Task | None] = relationship("Task", back_populates="artifacts")


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: generate_uuid("appr_")
    )
    video_id: Mapped[str] = mapped_column(String(64), ForeignKey("videos.id"), nullable=False)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision: Mapped[str | None] = mapped_column(String(16), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    video: Mapped[Video] = relationship("Video", back_populates="approvals")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    actor: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class Metric(Base):
    __tablename__ = "metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(String(64), ForeignKey("videos.id"), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    window: Mapped[str] = mapped_column(String(16), nullable=False)
    views: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    avg_watch_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    likes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    comments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    shares: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    saves: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    follows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    video: Mapped[Video] = relationship("Video", back_populates="metrics")
