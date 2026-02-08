from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import logging

from flask import Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from emw_backend.config import Config

log = logging.getLogger("emw_backend.auth")


@dataclass(frozen=True)
class VerifiedIdentity:
    uid: str
    email: Optional[str]
    display_name: Optional[str]


def _bearer_token(request: Request) -> Optional[str]:
    raw = request.headers.get("Authorization", "").strip()
    if not raw:
        return None
    if not raw.lower().startswith("bearer "):
        return None
    token = raw[len("bearer ") :].strip()
    return token or None


def _redact_token(token: str) -> str:
    if not token:
        return "<empty>"
    # Show only a tiny prefix/suffix to avoid leaking credentials in logs.
    if len(token) <= 12:
        return token[:2] + "…"
    return token[:6] + "…" + token[-4:]


def verify_request_identity(request: Request, config: Config) -> Optional[VerifiedIdentity]:
    # Dev escape hatch.
    if config.auth_mode == "disabled":
        return VerifiedIdentity(uid="dev-user", email=None, display_name="Dev User")

    raw_auth = (request.headers.get("Authorization", "") or "").strip()
    token = _bearer_token(request)
    if not token:
        if config.auth_debug:
            log.warning(
                "auth: missing/invalid Authorization header (auth_mode=%s) header=%r path=%s",
                config.auth_mode,
                raw_auth[:80],
                getattr(request, "path", ""),
            )
        return None

    if not config.firebase_project_id:
        # Can't verify audience without a project id.
        if config.auth_debug:
            log.warning(
                "auth: FIREBASE_PROJECT_ID not set; cannot verify token (token=%s) path=%s",
                _redact_token(token),
                getattr(request, "path", ""),
            )
        return None

    try:
        # Allow small local clock skew (common on dev machines / phones).
        # google-auth supports this kwarg; keep a fallback for older versions.
        try:
            info = id_token.verify_firebase_token(
                token,
                google_requests.Request(),
                audience=config.firebase_project_id,
                clock_skew_in_seconds=60,
            )
        except TypeError:
            info = id_token.verify_firebase_token(
                token,
                google_requests.Request(),
                audience=config.firebase_project_id,
            )
    except Exception as e:
        if config.auth_debug:
            log.warning(
                "auth: token verify failed (project_id=%s token=%s) err=%s path=%s",
                config.firebase_project_id,
                _redact_token(token),
                repr(e),
                getattr(request, "path", ""),
            )
        return None

    uid = info.get("uid") or info.get("sub")
    if not uid:
        if config.auth_debug:
            log.warning(
                "auth: token verified but missing uid/sub (token=%s) info_keys=%s path=%s",
                _redact_token(token),
                sorted(list(info.keys())) if isinstance(info, dict) else type(info),
                getattr(request, "path", ""),
            )
        return None

    ident = VerifiedIdentity(
        uid=str(uid),
        email=info.get("email"),
        display_name=info.get("name"),
    )

    if config.auth_debug:
        log.info(
            "auth: OK uid=%s email=%s path=%s",
            ident.uid,
            ident.email,
            getattr(request, "path", ""),
        )

    return ident
