from __future__ import annotations

import base64
import time
import uuid
from typing import Any, Dict, Optional

from flask import Blueprint, Response, jsonify, request, current_app
from sqlalchemy.orm import Session

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import User, UserFile
from emw_backend.storage_azure import AzureBlobConfig

# We use a simple backend-mediated upload/download flow (no SAS).


files_bp = Blueprint("files", __name__, url_prefix="/v1")


def _now_epoch() -> int:
    return int(time.time())


def _file_ext(name: str) -> str:
    if "." not in name:
        return ""
    dot = name.rfind(".")
    return name[dot:] if dot >= 0 else ""


def _azure_cfg(config: Config) -> AzureBlobConfig:
    return AzureBlobConfig(
        account=config.azure_storage_account,
        key=config.azure_storage_key,
        container=config.azure_blob_container,
    )


def _file_json(f: UserFile) -> Dict[str, Any]:
    return {
        "metadata": {
            "id": f.id,
            "name": f.name,
            "extension": f.extension or "",
            "file_extension": f.extension or "",
            "kind": f.kind,
            "etag": f.etag,
            "size_bytes": int(f.size_bytes),
            "content_type": f.content_type,
        },
        "storage": {
            "provider": f.storage_provider,
            "container": f.blob_container,
            "blob_key": f.blob_key,
        },
    }


class UserCtx:
    __slots__ = ("id", "firebase_uid")

    def __init__(self, *, id: str, firebase_uid: str):
        self.id = id
        self.firebase_uid = firebase_uid


def _require_user(config: Config) -> Optional[UserCtx]:
    ident = verify_request_identity(request, config)
    if not ident:
        return None

    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.firebase_uid == ident.uid).one_or_none()
        now = _now_epoch()
        if user is None:
            user = User(
                firebase_uid=ident.uid,
                email=ident.email,
                display_name=ident.display_name,
                created_at=now,
                last_seen_at=now,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user.last_seen_at = now
            db.commit()

        # Return a detached-safe snapshot.
        return UserCtx(id=str(user.id), firebase_uid=str(user.firebase_uid))
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

    db: Session = SessionLocal()
    try:
        q = db.query(UserFile).filter(UserFile.user_id == user.id)
        if kind:
            q = q.filter(UserFile.kind == kind)
        if ext:
            q = q.filter(UserFile.extension == ext)
        q = q.order_by(UserFile.name.asc())
        files = q.all()
        return jsonify({"files": [_file_json(f) for f in files]})
    finally:
        db.close()


@files_bp.get("/files/<file_id>")
def get_file(file_id: str):
    """Metadata only.

    File content is stored in Azure Blob. Use:
    - GET /v1/files/<id>/download to get a SAS URL
    """
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
        return jsonify(_file_json(f))
    finally:
        db.close()


@files_bp.post("/files/upload")
def upload_file_via_backend():
    """One-shot upload through backend (no SAS).

    This is a simpler flow than the legacy SAS-based upload.

    Request JSON:
      {
        "kind": "script"|"signal_raw"|"signal_text"|...,   (required)
        "name": "tesla.raw",                               (required)
        "content_type": "application/octet-stream",        (optional)
        "data_base64": "...",                               (required)
        "size_bytes": 1234                                   (optional)
      }

    Overwrite semantics:
      - If a file with same (user, kind, name) exists, its blob is overwritten in-place.
    """
    config: Config = current_app.config["EMWAVER_CONFIG"]
    user = _require_user(config)
    if user is None:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    kind = str(payload.get("kind") or "file").strip()
    name = str(payload.get("name") or "").strip()
    content_type = payload.get("content_type")
    data_b64 = payload.get("data_base64")
    size_bytes_raw = payload.get("size_bytes")

    if not name:
        return jsonify({"error": "Missing 'name'"}), 400
    if not data_b64 or not isinstance(data_b64, str):
        return jsonify({"error": "Missing 'data_base64'"}), 400
    if content_type is not None and not isinstance(content_type, str):
        return jsonify({"error": "Invalid 'content_type'"}), 400

    try:
        data = base64.b64decode(data_b64, validate=True)
    except Exception:
        return jsonify({"error": "Invalid base64 in 'data_base64'"}), 400

    if size_bytes_raw is not None:
        try:
            size_bytes = int(size_bytes_raw)
        except Exception:
            return jsonify({"error": "Invalid 'size_bytes'"}), 400
        if size_bytes < 0:
            return jsonify({"error": "Invalid 'size_bytes'"}), 400
        if size_bytes != len(data):
            return jsonify({"error": "'size_bytes' does not match decoded data length"}), 400

    ext = _file_ext(name)
    now = str(_now_epoch())

    # Upsert DB record by (user_id, kind, name)
    db: Session = SessionLocal()
    try:
        f = (
            db.query(UserFile)
            .filter(UserFile.user_id == user.id)
            .filter(UserFile.kind == kind)
            .filter(UserFile.name == name)
            .one_or_none()
        )

        if f is None:
            file_id = str(uuid.uuid4())
            blob_key = f"u/{user.firebase_uid}/{file_id}/{name}"
            f = UserFile(
                id=file_id,
                user_id=user.id,
                kind=kind,
                name=name,
                extension=ext,
                content_type=content_type or "application/octet-stream",
                storage_provider="azure_blob",
                blob_container=config.azure_blob_container,
                blob_key=blob_key,
                size_bytes=len(data),
                etag=now,
                created_at=int(now),
                updated_at=int(now),
            )
            db.add(f)
            db.commit()
            db.refresh(f)
        else:
            # Overwrite existing blob in-place.
            f.content_type = content_type or f.content_type or "application/octet-stream"
            f.size_bytes = len(data)
            f.etag = now
            f.updated_at = int(now)
            db.commit()
            db.refresh(f)

        # Upload bytes to Azure via account key.
        try:
            from azure.storage.blob import BlobServiceClient
            from azure.storage.blob import ContentSettings

            cfg = _azure_cfg(config)
            bs = BlobServiceClient(account_url=f"https://{cfg.account}.blob.core.windows.net", credential=cfg.key)
            bc = bs.get_blob_client(container=cfg.container, blob=f.blob_key)
            bc.upload_blob(
                data,
                overwrite=True,
                content_settings=ContentSettings(content_type=f.content_type),
            )
        except Exception as e:
            return jsonify({"error": f"Azure upload failed: {e}"}), 502

        return jsonify({"file": _file_json(f)}), 200
    finally:
        db.close()


@files_bp.get("/files/<file_id>/content")
def download_content_via_backend(file_id: str):
    """Downloads file bytes through backend (no SAS).

    Intended for manual testing and debugging.
    """
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

        try:
            from azure.storage.blob import BlobServiceClient

            cfg = _azure_cfg(config)
            bs = BlobServiceClient(account_url=f"https://{cfg.account}.blob.core.windows.net", credential=cfg.key)
            bc = bs.get_blob_client(container=cfg.container, blob=f.blob_key)
            data = bc.download_blob().readall()
        except Exception as e:
            return jsonify({"error": f"Azure download failed: {e}"}), 502

        return Response(data, mimetype=f.content_type)
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
        # Note: blob_key is not renamed; name is logical/metadata.
        f.etag = now
        f.updated_at = int(now)
        db.commit()
        db.refresh(f)
        return jsonify(_file_json(f))
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
            return jsonify({"error": "Conflict", "current": _file_json(f)}), 409

        # Best-effort: we do not fail delete if blob deletion fails.
        try:
            from azure.storage.blob import BlobServiceClient

            cfg = _azure_cfg(config)
            bs = BlobServiceClient(account_url=f"https://{cfg.account}.blob.core.windows.net", credential=cfg.key)
            bc = bs.get_blob_client(container=cfg.container, blob=f.blob_key)
            bc.delete_blob(delete_snapshots="include")
        except Exception:
            pass

        db.delete(f)
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# Legacy endpoints (v1 text mode) are intentionally removed from the main flow.
# If any older client still calls them, return a clear error.


@files_bp.put("/files/<file_id>")
def legacy_update_file(file_id: str):
    return jsonify({"error": "Deprecated."}), 410
