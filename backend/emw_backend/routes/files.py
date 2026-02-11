from __future__ import annotations

import base64
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import Blueprint, Response, current_app, jsonify, request

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config

files_bp = Blueprint("files", __name__, url_prefix="/v1")


def _now_epoch_ms() -> int:
    return int(time.time() * 1000)


def _require_user_uid(config: Config) -> Optional[str]:
    ident = verify_request_identity(request, config)
    return ident.uid if ident else None


def _sanitize_name(raw: str) -> Optional[str]:
    """User-visible file name.

    We store blobs at: u/<uid>/<name>

    Constraints:
    - no empty name
    - no backslashes
    - no parent traversal
    - no absolute paths
    - allow subfolders later if we want; for now keep it flat.
    """
    name = (raw or "").strip()
    if not name:
        return None
    if "\\" in name:
        return None
    if name.startswith("/"):
        return None
    if ".." in name.split("/"):
        return None
    if "/" in name:
        # keep it simple: flat namespace for now
        return None
    return name


def _blob_key(uid: str, name: str) -> str:
    return f"u/{uid}/{name}"


def _dt_to_iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _dedupe_user_file_rows(db: Any, uid: str) -> None:
    """Best-effort cleanup for legacy duplicate rows by (firebase_uid, name).

    The schema uses a unique index on (firebase_uid, name), but some older/manual DB states
    may still contain duplicates. Keep the newest row and delete older ones.
    """
    from emw_backend.models import UserFileIndex

    rows = (
        db.query(UserFileIndex)
        .filter(UserFileIndex.firebase_uid == uid)
        .order_by(UserFileIndex.name.asc(), UserFileIndex.updated_at.desc(), UserFileIndex.created_at.desc())
        .all()
    )

    if not rows:
        return

    by_name: Dict[str, List[Any]] = defaultdict(list)
    for row in rows:
        by_name[row.name].append(row)

    duplicate_ids: List[str] = []
    for same_name_rows in by_name.values():
        if len(same_name_rows) <= 1:
            continue
        # Rows are already sorted newest-first for each name.
        for older in same_name_rows[1:]:
            duplicate_ids.append(older.id)

    if not duplicate_ids:
        return

    (
        db.query(UserFileIndex)
        .filter(UserFileIndex.id.in_(duplicate_ids))
        .delete(synchronize_session=False)
    )
    db.commit()


@files_bp.get("/files")
def list_files():
    """List all user files from Postgres (metadata + inline bytes)."""
    config: Config = current_app.config["EMWAVER_CONFIG"]
    uid = _require_user_uid(config)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    from emw_backend.db import SessionLocal
    from emw_backend.models import UserFileIndex

    db = SessionLocal()
    try:
        _dedupe_user_file_rows(db, uid)
        rows = (
            db.query(UserFileIndex)
            .filter(UserFileIndex.firebase_uid == uid)
            .order_by(UserFileIndex.name.asc())
            .all()
        )

        files: List[Dict[str, Any]] = []
        for r in rows:
            files.append(
                {
                    "name": r.name,
                    "blob_key": r.blob_key,
                    "etag": r.etag,
                    "size_bytes": int(r.size_bytes or 0),
                    "last_modified": None,
                    "content_type": r.content_type,
                    "mtime_ms": int(r.mtime_ms),
                }
            )

        return jsonify({"files": files})
    finally:
        db.close()


@files_bp.get("/files/content")
def get_file_content():
    """Download bytes for a file from Postgres inline storage."""
    config: Config = current_app.config["EMWAVER_CONFIG"]
    uid = _require_user_uid(config)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    name = _sanitize_name(request.args.get("name") or "")
    if not name:
        return jsonify({"error": "Missing or invalid 'name'"}), 400

    from emw_backend.db import SessionLocal
    from emw_backend.models import UserFileIndex

    db = SessionLocal()
    try:
        row = (
            db.query(UserFileIndex)
            .filter(UserFileIndex.firebase_uid == uid)
            .filter(UserFileIndex.name == name)
            .first()
        )
        if not row:
            return jsonify({"error": "Not found"}), 404
        if row.content is None:
            return jsonify({"error": "File content missing (migration pending)"}), 404

        ct = row.content_type or "application/octet-stream"
        return Response(bytes(row.content), mimetype=ct)
    finally:
        db.close()


@files_bp.post("/files/upload")
def upload_file():
    """Upload bytes for a file by name (overwrite) into Postgres."""
    config: Config = current_app.config["EMWAVER_CONFIG"]
    uid = _require_user_uid(config)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    name = _sanitize_name(str(payload.get("name") or ""))
    content_type = payload.get("content_type")
    data_b64 = payload.get("data_base64")
    mtime_ms_raw = payload.get("mtime_ms")

    if not name:
        return jsonify({"error": "Missing or invalid 'name'"}), 400
    if not data_b64 or not isinstance(data_b64, str):
        return jsonify({"error": "Missing 'data_base64'"}), 400
    if content_type is not None and not isinstance(content_type, str):
        return jsonify({"error": "Invalid 'content_type'"}), 400

    try:
        data = base64.b64decode(data_b64, validate=True)
    except Exception:
        return jsonify({"error": "Invalid base64 in 'data_base64'"}), 400

    mtime_ms: int
    if mtime_ms_raw is None:
        mtime_ms = _now_epoch_ms()
    else:
        try:
            mtime_ms = int(mtime_ms_raw)
        except Exception:
            return jsonify({"error": "Invalid 'mtime_ms'"}), 400

    # Upsert Postgres row with inline bytes.
    try:
        from emw_backend.db import SessionLocal
        from emw_backend.models import UserFileIndex

        db = SessionLocal()
        try:
            now_s = int(time.time())
            dialect = getattr(getattr(db, "bind", None), "dialect", None)
            dialect_name = getattr(dialect, "name", "")

            values = {
                "firebase_uid": uid,
                "name": name,
                "blob_key": _blob_key(uid, name),
                "content": data,
                "mtime_ms": int(mtime_ms),
                "size_bytes": int(len(data)),
                "content_type": content_type or "application/octet-stream",
                "etag": None,
                "updated_at": now_s,
            }

            if dialect_name == "postgresql":
                from sqlalchemy.dialects.postgresql import insert as pg_insert

                stmt = pg_insert(UserFileIndex).values(**values)
                stmt = stmt.on_conflict_do_update(
                    index_elements=[UserFileIndex.firebase_uid, UserFileIndex.name],
                    set_=values,
                )
                db.execute(stmt)
            elif dialect_name == "sqlite":
                from sqlalchemy.dialects.sqlite import insert as sqlite_insert

                stmt = sqlite_insert(UserFileIndex).values(**values)
                stmt = stmt.on_conflict_do_update(
                    index_elements=[UserFileIndex.firebase_uid, UserFileIndex.name],
                    set_=values,
                )
                db.execute(stmt)
            else:
                # Best-effort fallback: update then insert.
                q = (
                    db.query(UserFileIndex)
                    .filter(UserFileIndex.firebase_uid == uid)
                    .filter(UserFileIndex.name == name)
                )
                row = q.first()
                if row:
                    for k, v in values.items():
                        setattr(row, k, v)
                else:
                    db.add(UserFileIndex(created_at=now_s, **values))

            db.commit()
        finally:
            db.close()
    except Exception as e:
        return jsonify({"error": f"DB index update failed: {str(e)}"}), 502

    # Return metadata
    return jsonify(
        {
            "file": {
                "name": name,
                "blob_key": _blob_key(uid, name),
                "etag": None,
                "size_bytes": int(len(data)),
                "last_modified": _dt_to_iso(datetime.now(timezone.utc)),
                "content_type": content_type or "application/octet-stream",
                "mtime_ms": mtime_ms,
            }
        }
    )


@files_bp.delete("/files")
def delete_file():
    config: Config = current_app.config["EMWAVER_CONFIG"]
    uid = _require_user_uid(config)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    name = _sanitize_name(request.args.get("name") or "")
    if not name:
        return jsonify({"error": "Missing or invalid 'name'"}), 400

    from emw_backend.db import SessionLocal
    from emw_backend.models import UserFileIndex

    # Delete row (inline bytes included).
    try:
        db = SessionLocal()
        try:
            deleted = (
                db.query(UserFileIndex)
                .filter(UserFileIndex.firebase_uid == uid)
                .filter(UserFileIndex.name == name)
                .delete(synchronize_session=False)
            )
            db.commit()
            if deleted <= 0:
                return jsonify({"error": "Not found"}), 404
        finally:
            db.close()
    except Exception as e:
        return jsonify({"error": f"DB delete failed: {str(e)}"}), 502

    return jsonify({"ok": True})
