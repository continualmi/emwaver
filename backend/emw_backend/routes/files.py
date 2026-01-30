from __future__ import annotations

import time
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request, current_app
from sqlalchemy.orm import Session

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import User, UserFile


files_bp = Blueprint("files", __name__, url_prefix="/v1")


def _now_epoch() -> int:
    return int(time.time())


def _file_ext(name: str) -> str:
    if "." not in name:
        return ""
    dot = name.rfind(".")
    return name[dot:] if dot >= 0 else ""


def _file_json(f: UserFile, include_content: bool) -> Dict[str, Any]:
    obj: Dict[str, Any] = {
        "metadata": {
            "id": f.id,
            "name": f.name,
            "extension": f.extension or "",
            "file_extension": f.extension or "",
            "kind": f.kind,
            "etag": f.etag,
            "size_bytes": int(f.size_bytes),
            "content_type": f.content_type,
        }
    }
    if include_content:
        obj["text_content"] = f.content_text or ""
    return obj


def _require_user(config: Config) -> Optional[User]:
    ident = verify_request_identity(request, config)
    if not ident:
        return None

    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.firebase_uid == ident.uid).one_or_none()
        now = _now_epoch()
        if user is None:
            user = User(firebase_uid=ident.uid, email=ident.email, display_name=ident.display_name, created_at=now, last_seen_at=now)
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user.last_seen_at = now
            db.commit()
        return user
    finally:
        db.close()


@files_bp.get("/files")
def list_files():
    config: Config = current_app.config["EMWAVER_CONFIG"]
    user = _require_user(config)
    if user is None:
        return jsonify({"error": "Unauthorized"}), 401

    kind = (request.args.get("kind") or "").strip()
    ext = (request.args.get("ext") or "").strip()
    include_content = (request.args.get("include_content") or "0").strip() == "1"

    db: Session = SessionLocal()
    try:
        q = db.query(UserFile).filter(UserFile.user_id == user.id)
        if kind:
            q = q.filter(UserFile.kind == kind)
        if ext:
            q = q.filter(UserFile.extension == ext)
        q = q.order_by(UserFile.name.asc())
        files = q.all()
        return jsonify({"files": [_file_json(f, include_content) for f in files]})
    finally:
        db.close()


@files_bp.get("/files/<file_id>")
def get_file(file_id: str):
    config: Config = current_app.config["EMWAVER_CONFIG"]
    user = _require_user(config)
    if user is None:
        return jsonify({"error": "Unauthorized"}), 401

    db: Session = SessionLocal()
    try:
        f = (
            db.query(UserFile)
            .filter(UserFile.user_id == user.id)
            .filter(UserFile.id == file_id)
            .one_or_none()
        )
        if f is None:
            return jsonify({"error": "Not found"}), 404
        return jsonify(_file_json(f, True))
    finally:
        db.close()


@files_bp.post("/files")
def create_file():
    config: Config = current_app.config["EMWAVER_CONFIG"]
    user = _require_user(config)
    if user is None:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    kind = str(payload.get("kind") or "").strip()
    name = str(payload.get("name") or "").strip()
    text = payload.get("content")
    content_type = payload.get("content_type")

    if not kind:
        return jsonify({"error": "Missing 'kind'"}), 400
    if not name:
        return jsonify({"error": "Missing 'name'"}), 400
    if text is not None and not isinstance(text, str):
        return jsonify({"error": "Invalid 'content'"}), 400
    if content_type is not None and not isinstance(content_type, str):
        return jsonify({"error": "Invalid 'content_type'"}), 400

    ext = _file_ext(name)
    now = str(_now_epoch())
    content_text = text if text is not None else ""
    size_bytes = len(content_text.encode("utf-8"))

    db: Session = SessionLocal()
    try:
        existing = (
            db.query(UserFile)
            .filter(UserFile.user_id == user.id)
            .filter(UserFile.kind == kind)
            .filter(UserFile.name == name)
            .one_or_none()
        )
        if existing is not None:
            return jsonify({"error": "File already exists"}), 409

        f = UserFile(
            user_id=user.id,
            kind=kind,
            name=name,
            extension=ext,
            content_type=content_type or "text/plain",
            content_text=content_text,
            size_bytes=size_bytes,
            etag=now,
            created_at=int(now),
            updated_at=int(now),
        )
        db.add(f)
        db.commit()
        db.refresh(f)
        return jsonify(_file_json(f, False)), 201
    finally:
        db.close()


@files_bp.put("/files/<file_id>")
def update_file(file_id: str):
    config: Config = current_app.config["EMWAVER_CONFIG"]
    user = _require_user(config)
    if user is None:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    expected_etag = str(payload.get("etag") or "").strip()
    text = payload.get("content")
    if not expected_etag:
        return jsonify({"error": "Missing 'etag'"}), 400
    if text is not None and not isinstance(text, str):
        return jsonify({"error": "Invalid 'content'"}), 400

    content_text = text if text is not None else ""
    size_bytes = len(content_text.encode("utf-8"))
    now = str(_now_epoch())

    db: Session = SessionLocal()
    try:
        f = (
            db.query(UserFile)
            .filter(UserFile.user_id == user.id)
            .filter(UserFile.id == file_id)
            .one_or_none()
        )
        if f is None:
            return jsonify({"error": "Not found"}), 404
        if f.etag != expected_etag:
            return jsonify({"error": "Conflict", "current": _file_json(f, False)}), 409

        f.content_text = content_text
        f.size_bytes = size_bytes
        f.etag = now
        f.updated_at = int(now)
        db.commit()
        db.refresh(f)
        return jsonify(_file_json(f, False))
    finally:
        db.close()


@files_bp.post("/files/<file_id>/rename")
def rename_file(file_id: str):
    config: Config = current_app.config["EMWAVER_CONFIG"]
    user = _require_user(config)
    if user is None:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    new_name = str(payload.get("name") or "").strip()
    if not new_name:
        return jsonify({"error": "Missing 'name'"}), 400

    db: Session = SessionLocal()
    try:
        f = (
            db.query(UserFile)
            .filter(UserFile.user_id == user.id)
            .filter(UserFile.id == file_id)
            .one_or_none()
        )
        if f is None:
            return jsonify({"error": "Not found"}), 404

        existing = (
            db.query(UserFile)
            .filter(UserFile.user_id == user.id)
            .filter(UserFile.kind == f.kind)
            .filter(UserFile.name == new_name)
            .one_or_none()
        )
        if existing is not None and existing.id != f.id:
            return jsonify({"error": "Name already in use"}), 409

        now = str(_now_epoch())
        f.name = new_name
        f.extension = _file_ext(new_name)
        f.etag = now
        f.updated_at = int(now)
        db.commit()
        db.refresh(f)
        return jsonify(_file_json(f, False))
    finally:
        db.close()


@files_bp.delete("/files/<file_id>")
def delete_file(file_id: str):
    config: Config = current_app.config["EMWAVER_CONFIG"]
    user = _require_user(config)
    if user is None:
        return jsonify({"error": "Unauthorized"}), 401

    expected_etag = (request.args.get("etag") or "").strip()
    if not expected_etag:
        return jsonify({"error": "Missing 'etag'"}), 400

    db: Session = SessionLocal()
    try:
        f = (
            db.query(UserFile)
            .filter(UserFile.user_id == user.id)
            .filter(UserFile.id == file_id)
            .one_or_none()
        )
        if f is None:
            return jsonify({"error": "Not found"}), 404
        if f.etag != expected_etag:
            return jsonify({"error": "Conflict", "current": _file_json(f, False)}), 409

        db.delete(f)
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()
