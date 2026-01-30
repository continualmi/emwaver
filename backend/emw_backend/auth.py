from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from flask import Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from emw_backend.config import Config


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


def verify_request_identity(request: Request, config: Config) -> Optional[VerifiedIdentity]:
    # Dev escape hatch.
    if config.auth_mode == "disabled":
        return VerifiedIdentity(uid="dev-user", email=None, display_name="Dev User")

    token = _bearer_token(request)
    if not token:
        return None

    if not config.firebase_project_id:
        # Can't verify audience without a project id.
        return None

    try:
        info = id_token.verify_firebase_token(
            token,
            google_requests.Request(),
            audience=config.firebase_project_id,
        )
    except Exception:
        return None

    uid = info.get("uid") or info.get("sub")
    if not uid:
        return None

    return VerifiedIdentity(
        uid=str(uid),
        email=info.get("email"),
        display_name=info.get("name"),
    )
