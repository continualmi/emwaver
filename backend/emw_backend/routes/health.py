import os

from flask import Blueprint, current_app, jsonify


health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    return jsonify({"ok": True})


@health_bp.get("/health/config")
@health_bp.get("/v1/health/config")
def health_config():
    """Non-sensitive runtime config health for deployment debugging."""
    cfg = current_app.config.get("EMWAVER_CONFIG")

    def has_env(name: str) -> bool:
        return bool((os.environ.get(name) or "").strip())

    auth_mode = (os.environ.get("EMWAVER_AUTH_MODE") or "").strip().lower() or "enabled"
    firebase_project_id_configured = bool(getattr(cfg, "firebase_project_id", "") or "")
    firebase_admin_json_b64_configured = has_env("FIREBASE_ADMIN_JSON_B64")
    firebase_service_account_json_configured = has_env("FIREBASE_SERVICE_ACCOUNT_JSON")

    return jsonify(
        {
            "ok": True,
            "auth": {
                "mode": auth_mode,
                "firebase_project_id_configured": firebase_project_id_configured,
                "firebase_admin_json_b64_configured": firebase_admin_json_b64_configured,
                "firebase_service_account_json_configured": firebase_service_account_json_configured,
                "handoff_token_mint_ready": firebase_admin_json_b64_configured,
            },
            "storage": {
                "database_url_configured": bool(getattr(cfg, "database_url", "") or ""),
                "azure_storage_account_configured": bool(getattr(cfg, "azure_storage_account", "") or ""),
                "azure_storage_key_configured": bool(getattr(cfg, "azure_storage_key", "") or ""),
                "azure_blob_container_configured": bool(getattr(cfg, "azure_blob_container", "") or ""),
            },
        }
    )
