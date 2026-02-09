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

    # Provisioning
    provisioning_root_private_key_b64: str
    provisioning_allowed_email: str

    # Auth
    auth_mode: str
    firebase_project_id: str
    auth_debug: bool

    # Azure Blob storage
    azure_storage_account: str
    azure_storage_key: str
    azure_blob_container: str

    # Agent (OpenAI-compatible upstream)
    openai_base_url: str
    openai_api_key: str
    openai_model: str

    # Store (Stripe)
    stripe_secret_key: str
    stripe_webhook_secret: str
    store_stripe_price_id: str
    store_success_url: str
    store_cancel_url: str
    store_shipping_countries: List[str]

    # SecureWaver / device authenticity
    root_public_key_b64: str

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

            # Provisioning
            provisioning_root_private_key_b64=_env("EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64", ""),
            provisioning_allowed_email=_env("EMWAVER_PROVISIONING_ALLOWED_EMAIL", "maarnotto@gmail.com"),

            auth_mode=_env("EMWAVER_AUTH_MODE", "firebase"),
            firebase_project_id=_env("FIREBASE_PROJECT_ID", ""),
            auth_debug=_env("EMWAVER_AUTH_DEBUG", "0") in ("1", "true", "yes", "on"),
            azure_storage_account=_env("AZURE_STORAGE_ACCOUNT", ""),
            azure_storage_key=_env("AZURE_STORAGE_KEY", ""),
            azure_blob_container=_env("AZURE_BLOB_CONTAINER", "emwaver-user-files"),
            openai_base_url=_env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            openai_api_key=_env("OPENAI_API_KEY", ""),
            openai_model=_env("OPENAI_MODEL", "gpt-4o-mini"),

            stripe_secret_key=_env("STRIPE_SECRET_KEY", ""),
            stripe_webhook_secret=_env("STRIPE_WEBHOOK_SECRET", ""),
            store_stripe_price_id=_env("STORE_STRIPE_PRICE_ID", ""),
            store_success_url=_env("STORE_SUCCESS_URL", ""),
            store_cancel_url=_env("STORE_CANCEL_URL", ""),
            store_shipping_countries=[c.strip() for c in _env("STORE_SHIPPING_COUNTRIES", "").split(",") if c.strip()],

            root_public_key_b64=_env("EMWAVER_ROOT_PUBLIC_KEY_B64", ""),
        )
