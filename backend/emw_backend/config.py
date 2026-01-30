import os
from dataclasses import dataclass
from typing import List, Union


def _env(key: str, default: str = "") -> str:
    v = os.environ.get(key)
    if v is None:
        return default
    v = v.strip()
    return v if v else default


@dataclass(frozen=True)
class Config:
    database_url: str
    cors_origins: Union[List[str], str]

    # Auth
    auth_mode: str
    firebase_project_id: str

    # Agent
    openrouter_api_key: str
    openrouter_model: str

    @staticmethod
    def from_env() -> "Config":
        cors_raw = _env("CORS_ORIGINS", "*")
        cors_origins: Union[List[str], str]
        if cors_raw == "*":
            cors_origins = "*"
        else:
            cors_origins = [o.strip() for o in cors_raw.split(",") if o.strip()]

        return Config(
            database_url=_env("DATABASE_URL", "sqlite:///./emwaver.db"),
            cors_origins=cors_origins,
            auth_mode=_env("EMWAVER_AUTH_MODE", "firebase"),
            firebase_project_id=_env("FIREBASE_PROJECT_ID", ""),
            openrouter_api_key=_env("OPENROUTER_API_KEY", ""),
            openrouter_model=_env("OPENROUTER_MODEL", "x-ai/grok-4.1-fast"),
        )
