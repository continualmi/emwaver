from __future__ import annotations

import time
import uuid
from typing import Optional

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from emw_backend.db import Base


def _now_epoch() -> int:
    return int(time.time())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    firebase_uid: Mapped[str] = mapped_column(String(128), unique=True, index=True)

    email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    created_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)
    last_seen_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)



class UserFileIndex(Base):
    """Current file index (Postgres): bytes in Azure Blob, metadata/index in SQL.

    We intentionally store firebase_uid directly to avoid joins for list/sync.
    """

    __tablename__ = "user_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    firebase_uid: Mapped[str] = mapped_column(String(128), index=True)

    name: Mapped[str] = mapped_column(String(512))
    blob_key: Mapped[str] = mapped_column(String(768))

    mtime_ms: Mapped[int] = mapped_column(BigInteger)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    content_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    etag: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)
    updated_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)


Index("idx_user_files_uid_name", UserFileIndex.firebase_uid, UserFileIndex.name, unique=True)


# --- Agent chat persistence ---


def _now_ms() -> int:
    return int(time.time() * 1000)


class AgentConversation(Base):
    __tablename__ = "agent_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    firebase_uid: Mapped[str] = mapped_column(String(128), index=True)

    title: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)


Index("idx_agent_conversations_uid_updated", AgentConversation.firebase_uid, AgentConversation.updated_at_ms)


class AgentMessage(Base):
    __tablename__ = "agent_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("agent_conversations.id"), index=True)
    firebase_uid: Mapped[str] = mapped_column(String(128), index=True)

    role: Mapped[str] = mapped_column(String(16))  # user|assistant|system
    content: Mapped[str] = mapped_column(Text)

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)


Index("idx_agent_messages_convo_created", AgentMessage.conversation_id, AgentMessage.created_at_ms)


# --- Agent provider settings / credentials ---


class AgentUserSettings(Base):
    __tablename__ = "agent_user_settings"

    # One row per user.
    firebase_uid: Mapped[str] = mapped_column(String(128), primary_key=True)

    # "chatgpt" (Codex via ChatGPT subscription) | "platform" (OpenAI Platform API key)
    llm_provider: Mapped[str] = mapped_column(String(32), default="chatgpt")

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)


class AgentChatGptCredential(Base):
    __tablename__ = "agent_chatgpt_credentials"

    # One row per user.
    firebase_uid: Mapped[str] = mapped_column(String(128), primary_key=True)

    # OAuth tokens from auth.openai.com (Codex / ChatGPT subscription access).
    # NOTE: Stored as plaintext in DB for now (no secrets manager integration yet).
    refresh_token: Mapped[str] = mapped_column(Text)
    access_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expires_at_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Optional header for org/workspace subscriptions.
    chatgpt_account_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)


# --- Host sessions (presence + status) ---


class HostSession(Base):
    __tablename__ = "host_sessions"

    # Client-generated stable id (per-install recommended)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    firebase_uid: Mapped[str] = mapped_column(String(128), index=True)

    platform: Mapped[str] = mapped_column(String(32), default="unknown")
    device_name: Mapped[str] = mapped_column(String(128), default="")
    app_version: Mapped[str] = mapped_column(String(64), default="")

    # JSON strings to avoid dialect issues without JSONB.
    capabilities_json: Mapped[str] = mapped_column(Text, default="{}")
    status_json: Mapped[str] = mapped_column(Text, default="{}")

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms)
    last_seen_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)


Index("idx_host_sessions_uid_last_seen", HostSession.firebase_uid, HostSession.last_seen_at_ms)
