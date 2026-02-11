from __future__ import annotations

import time
import uuid
from typing import Optional

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, LargeBinary, String, Text
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


# --- Entitlements (EMWaver Pro) ---


def _now_ms() -> int:
    return int(time.time() * 1000)


class UserEntitlement(Base):
    __tablename__ = "user_entitlements"

    # Keep it simple: 1 row per user (firebase_uid as primary key).
    firebase_uid: Mapped[str] = mapped_column(String(128), primary_key=True)

    # Pro subscription state.
    pro_active: Mapped[int] = mapped_column(Integer, default=0)  # 0/1
    pro_expires_at_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)


Index("idx_user_entitlements_updated", UserEntitlement.updated_at_ms)


# --- ELM Credits (token balance) ---


class UserCreditBalance(Base):
    __tablename__ = "user_credit_balances"

    firebase_uid: Mapped[str] = mapped_column(String(128), primary_key=True)

    # Token balance (credits) for EMWaver-managed models.
    balance_tokens: Mapped[int] = mapped_column(BigInteger, default=0)

    # Current billing period window for the balance (rolling until Stripe billing is wired).
    period_start_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms)
    period_end_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms)

    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)


Index("idx_user_credit_balances_updated", UserCreditBalance.updated_at_ms)


class UserFileIndex(Base):
    """Current file store/index in Postgres.

    We intentionally store firebase_uid directly to avoid joins for list/sync.
    """

    __tablename__ = "user_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    firebase_uid: Mapped[str] = mapped_column(String(128), index=True)

    name: Mapped[str] = mapped_column(String(512))
    blob_key: Mapped[str] = mapped_column(String(768))
    content: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)

    mtime_ms: Mapped[int] = mapped_column(BigInteger)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    content_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    etag: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)
    updated_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)


Index("idx_user_files_uid_name", UserFileIndex.firebase_uid, UserFileIndex.name, unique=True)


# --- Agent chat persistence ---


class AgentConversation(Base):
    __tablename__ = "agent_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    firebase_uid: Mapped[str] = mapped_column(String(128), index=True)

    title: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    agent_type: Mapped[str] = mapped_column(String(16), default="llm")  # llm|elm

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


# --- Store / orders ---


class StoreOrder(Base):
    __tablename__ = "store_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)

    # Optional: linked account. For guest checkout this starts null.
    firebase_uid: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)

    email: Mapped[str] = mapped_column(String(256), default="")
    status: Mapped[str] = mapped_column(String(32), default="created", index=True)

    quantity: Mapped[int] = mapped_column(Integer, default=1)

    stripe_checkout_session_id: Mapped[str] = mapped_column(String(255), default="", index=True)
    stripe_payment_intent_id: Mapped[str] = mapped_column(String(255), default="", index=True)

    currency: Mapped[str] = mapped_column(String(16), default="")
    amount_total: Mapped[int] = mapped_column(Integer, default=0)  # minor units (cents)

    # Stripe shipping_details (JSON). Stored as text for dialect portability.
    shipping_json: Mapped[str] = mapped_column(Text, default="{}")

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)

    def to_public_dict(self):
        return {
            "id": self.id,
            "status": self.status,
            "email": self.email,
            "quantity": int(self.quantity or 0),
            "currency": self.currency,
            "amount_total": int(self.amount_total or 0),
            "stripe_checkout_session_id": self.stripe_checkout_session_id,
            "created_at_ms": int(self.created_at_ms or 0),
            "updated_at_ms": int(self.updated_at_ms or 0),
        }


# --- User devices (SecureWaver identity binding) ---


# --- Auth handoff (web sign-in -> native apps) ---


class AuthHandoffCode(Base):
    __tablename__ = "auth_handoff_codes"

    # sha256 of uppercased code
    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)

    firebase_uid: Mapped[str] = mapped_column(String(128), index=True)

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)
    consumed_at_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)


Index("idx_auth_handoff_uid_created", AuthHandoffCode.firebase_uid, AuthHandoffCode.created_at_ms)


class UserDevice(Base):
    __tablename__ = "user_devices"

    # Base64-encoded 16-byte device id (stable).
    device_id_b64: Mapped[str] = mapped_column(String(64), primary_key=True)

    # Base64-encoded ed25519 signature over the raw 16-byte device id.
    proof_b64: Mapped[str] = mapped_column(String(128), default="")

    # Optional owner; device can exist unowned in DB, but product intent is to attach on login.
    firebase_uid: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)

    label: Mapped[str] = mapped_column(String(128), default="")

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)
    last_seen_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)

    def to_public_dict(self):
        return {
            "device_id_b64": self.device_id_b64,
            "label": self.label,
            "created_at_ms": int(self.created_at_ms or 0),
            "updated_at_ms": int(self.updated_at_ms or 0),
            "last_seen_at_ms": int(self.last_seen_at_ms or 0),
        }


# --- EMWaver Society (community) ---


class SocietyPost(Base):
    __tablename__ = "society_posts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # announcement|discussion|script|video
    kind: Mapped[str] = mapped_column(String(32), index=True, default="discussion")

    title: Mapped[str] = mapped_column(String(256), default="")
    summary: Mapped[str] = mapped_column(String(512), default="")

    # Markdown body (or script/video details).
    body_md: Mapped[str] = mapped_column(Text, default="")

    # Optional canonical slug for frontend routes.
    slug: Mapped[str] = mapped_column(String(256), default="", index=True)

    # Author (nullable for imported/official announcements).
    firebase_uid: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    author_email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    author_display_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    tags_json: Mapped[str] = mapped_column(Text, default="[]")

    published: Mapped[int] = mapped_column(Integer, default=0, index=True)  # 0/1
    pinned: Mapped[int] = mapped_column(Integer, default=0, index=True)  # 0/1
    locked: Mapped[int] = mapped_column(Integer, default=0)  # 0/1

    # Media gating / attachment (used by Videos; future: scripts with blobs).
    pro_only: Mapped[int] = mapped_column(Integer, default=0, index=True)  # 0/1
    media_blob_key: Mapped[str] = mapped_column(String(768), default="")
    media_poster_blob_key: Mapped[str] = mapped_column(String(768), default="")
    media_duration_s: Mapped[int] = mapped_column(Integer, default=0)

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)

    def to_public_dict(self, include_body: bool = False):
        d = {
            "id": self.id,
            "kind": self.kind,
            "slug": self.slug,
            "title": self.title,
            "summary": self.summary,
            "tags": self.tags_json,
            "pinned": int(self.pinned or 0),
            "locked": int(self.locked or 0),
            "pro_only": int(self.pro_only or 0),
            "created_at_ms": int(self.created_at_ms or 0),
            "updated_at_ms": int(self.updated_at_ms or 0),
            "author": {
                "firebase_uid": self.firebase_uid,
                "display_name": self.author_display_name,
            },
        }
        if include_body:
            d["body_md"] = self.body_md
        return d


Index("idx_society_posts_kind_created", SocietyPost.kind, SocietyPost.created_at_ms)
Index("idx_society_posts_published_created", SocietyPost.published, SocietyPost.created_at_ms)


class SocietyComment(Base):
    __tablename__ = "society_comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    post_id: Mapped[str] = mapped_column(String(36), ForeignKey("society_posts.id"), index=True)

    firebase_uid: Mapped[str] = mapped_column(String(128), index=True)
    author_email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    author_display_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    body_md: Mapped[str] = mapped_column(Text, default="")

    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=_now_ms, index=True)

    def to_public_dict(self):
        return {
            "id": self.id,
            "post_id": self.post_id,
            "body_md": self.body_md,
            "created_at_ms": int(self.created_at_ms or 0),
            "updated_at_ms": int(self.updated_at_ms or 0),
            "author": {
                "firebase_uid": self.firebase_uid,
                "display_name": self.author_display_name,
            },
        }


Index("idx_society_comments_post_created", SocietyComment.post_id, SocietyComment.created_at_ms)
