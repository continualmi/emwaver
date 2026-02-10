from __future__ import annotations

import uuid
from typing import Optional

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import desc, select

from emw_backend.auth import require_auth_user
from emw_backend.db import SessionLocal
from emw_backend.models import SocietyComment, SocietyPost, UserDevice

society_bp = Blueprint("society", __name__, url_prefix="/v1/society")


def _now_ms() -> int:
    import time

    return int(time.time() * 1000)


def _parse_int(name: str, raw: Optional[str], default: int, min_v: int, max_v: int) -> int:
    try:
        v = int(raw) if raw is not None else int(default)
    except Exception:
        v = int(default)
    if v < min_v:
        v = min_v
    if v > max_v:
        v = max_v
    return v


@society_bp.get("/posts")
def list_posts():
    """Read-only list of EMWaver Society posts.

    Query:
      kind: announcement|discussion|script|video (optional)
      limit: int (default 20)
      before_ms: cursor for pagination (created_at_ms < before_ms)
    """

    kind = (request.args.get("kind") or "").strip().lower() or None
    limit = _parse_int("limit", request.args.get("limit"), default=20, min_v=1, max_v=50)

    before_ms_raw = (request.args.get("before_ms") or "").strip()
    before_ms = None
    if before_ms_raw:
        try:
            before_ms = int(before_ms_raw)
        except Exception:
            before_ms = None

    db = SessionLocal()
    try:
        q = select(SocietyPost).where(SocietyPost.published == 1)
        if kind:
            q = q.where(SocietyPost.kind == kind)
        if before_ms is not None:
            q = q.where(SocietyPost.created_at_ms < before_ms)

        q = q.order_by(desc(SocietyPost.created_at_ms)).limit(limit)
        rows = db.execute(q).scalars().all()

        return jsonify(
            {
                "posts": [r.to_public_dict() for r in rows],
            }
        )
    finally:
        db.close()


@society_bp.get("/posts/<post_id>")
def get_post(post_id: str):
    db = SessionLocal()
    try:
        row = db.get(SocietyPost, post_id)
        if not row or not row.published:
            return jsonify({"error": "not_found"}), 404
        return jsonify({"post": row.to_public_dict(include_body=True)})
    finally:
        db.close()


@society_bp.get("/posts/<post_id>/comments")
def list_comments(post_id: str):
    limit = _parse_int("limit", request.args.get("limit"), default=50, min_v=1, max_v=200)

    db = SessionLocal()
    try:
        post = db.get(SocietyPost, post_id)
        if not post or not post.published:
            return jsonify({"error": "not_found"}), 404

        q = (
            select(SocietyComment)
            .where(SocietyComment.post_id == post_id)
            .order_by(SocietyComment.created_at_ms.asc())
            .limit(limit)
        )
        rows = db.execute(q).scalars().all()
        return jsonify({"comments": [c.to_public_dict() for c in rows]})
    finally:
        db.close()


@society_bp.post("/posts/<post_id>/comments")
def create_comment(post_id: str):
    """Create a comment.

    Requirements:
      - signed in
      - account has >=1 attached/verified genuine device

    Payload: { body_md }
    """

    config = current_app.config.get("EMWAVER_CONFIG")
    user = require_auth_user(config)

    payload = request.get_json(silent=True) or {}
    body_md = str(payload.get("body_md") or "").strip()
    if not body_md:
        return jsonify({"error": "missing_body_md"}), 400
    if len(body_md) > 20_000:
        return jsonify({"error": "body_too_long"}), 400

    db = SessionLocal()
    try:
        post = db.get(SocietyPost, post_id)
        if not post or not post.published:
            return jsonify({"error": "not_found"}), 404
        if post.locked:
            return jsonify({"error": "locked"}), 403

        # Device-attached gating (anti-spam + aligns with platform policy).
        has_device = db.execute(
            select(UserDevice.device_id_b64).where(UserDevice.firebase_uid == user.firebase_uid).limit(1)
        ).first()
        if not has_device:
            return jsonify({"error": "device_required"}), 403

        now = _now_ms()
        row = SocietyComment(
            id=str(uuid.uuid4()),
            post_id=post_id,
            firebase_uid=user.firebase_uid,
            author_email=user.email,
            author_display_name=user.display_name,
            body_md=body_md,
            created_at_ms=now,
            updated_at_ms=now,
        )
        db.add(row)

        # Bump post updated time for activity ordering later.
        post.updated_at_ms = now

        db.commit()
        return jsonify({"comment": row.to_public_dict()}), 201
    finally:
        db.close()
