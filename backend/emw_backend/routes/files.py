from __future__ import annotations

import base64
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import Blueprint, Response, current_app, jsonify, request

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config

files_bp = Blueprint("files", __name__, url_prefix="/v1")


def _now_epoch_ms() -> int:
    return int(time.time() * 1000)


def _azure_blob_service(config: Config):
    from azure.storage.blob import BlobServiceClient

    if not config.azure_storage_account or not config.azure_storage_key or not config.azure_blob_container:
        raise RuntimeError(
            "Azure Blob storage is not configured (AZURE_STORAGE_ACCOUNT/AZURE_STORAGE_KEY/AZURE_BLOB_CONTAINER)"
        )

    url = f"https://{config.azure_storage_account}.blob.core.windows.net"
    return BlobServiceClient(account_url=url, credential=config.azure_storage_key)


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


def _file_json_from_blob(blob: Any) -> Dict[str, Any]:
    # Azure returns metadata keys lowercased in practice.
    md = getattr(blob, "metadata", None) or {}
    mtime_ms = md.get("mtime_ms")
    try:
        mtime_ms_int = int(mtime_ms) if mtime_ms is not None else None
    except Exception:
        mtime_ms_int = None

    return {
        "name": blob.name.split("/")[-1],
        "blob_key": blob.name,
        "etag": getattr(blob, "etag", None),
        "size_bytes": int(getattr(blob, "size", 0) or 0),
        "last_modified": _dt_to_iso(getattr(blob, "last_modified", None)),
        "content_type": getattr(getattr(blob, "content_settings", None), "content_type", None),
        "mtime_ms": mtime_ms_int,
    }


@files_bp.get("/files")
def list_files():
    """List all user files (blobs-only)."""
    config: Config = current_app.config["EMWAVER_CONFIG"]
    uid = _require_user_uid(config)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    svc = _azure_blob_service(config)
    container = svc.get_container_client(config.azure_blob_container)

    prefix = f"u/{uid}/"
    blobs = container.list_blobs(name_starts_with=prefix, include=["metadata"])

    files: List[Dict[str, Any]] = []
    for b in blobs:
        # b.name is full key
        files.append(_file_json_from_blob(b))

    files.sort(key=lambda x: x.get("name") or "")
    return jsonify({"files": files})


@files_bp.get("/files/content")
def get_file_content():
    """Download bytes for a file by name."""
    config: Config = current_app.config["EMWAVER_CONFIG"]
    uid = _require_user_uid(config)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    name = _sanitize_name(request.args.get("name") or "")
    if not name:
        return jsonify({"error": "Missing or invalid 'name'"}), 400

    svc = _azure_blob_service(config)
    blob = svc.get_blob_client(container=config.azure_blob_container, blob=_blob_key(uid, name))

    try:
        downloader = blob.download_blob()
        data = downloader.readall()
        props = blob.get_blob_properties()
    except Exception as e:
        msg = str(e)
        if "BlobNotFound" in msg or "The specified blob does not exist" in msg:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"error": f"Azure download failed: {msg}"}), 502

    ct = getattr(getattr(props, "content_settings", None), "content_type", None) or "application/octet-stream"
    return Response(data, mimetype=ct)


@files_bp.post("/files/upload")
def upload_file():
    """Upload bytes for a file by name (overwrite)."""
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

    svc = _azure_blob_service(config)
    blob = svc.get_blob_client(container=config.azure_blob_container, blob=_blob_key(uid, name))

    try:
        from azure.storage.blob import ContentSettings

        blob.upload_blob(
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type or "application/octet-stream"),
            metadata={"mtime_ms": str(mtime_ms)},
        )
        props = blob.get_blob_properties()
    except Exception as e:
        return jsonify({"error": f"Azure upload failed: {str(e)}"}), 502

    # Return metadata (best-effort)
    return jsonify(
        {
            "file": {
                "name": name,
                "blob_key": _blob_key(uid, name),
                "etag": getattr(props, "etag", None),
                "size_bytes": int(getattr(props, "size", 0) or len(data)),
                "last_modified": _dt_to_iso(getattr(props, "last_modified", None)),
                "content_type": getattr(getattr(props, "content_settings", None), "content_type", None),
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

    svc = _azure_blob_service(config)
    blob = svc.get_blob_client(container=config.azure_blob_container, blob=_blob_key(uid, name))

    try:
        blob.delete_blob()
    except Exception as e:
        msg = str(e)
        if "BlobNotFound" in msg or "The specified blob does not exist" in msg:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"error": f"Azure delete failed: {msg}"}), 502

    return jsonify({"ok": True})
