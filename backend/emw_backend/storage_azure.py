from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

from azure.storage.blob import BlobSasPermissions, generate_blob_sas


@dataclass(frozen=True)
class AzureBlobConfig:
    account: str
    key: str
    container: str


def _now() -> int:
    return int(time.time())


def _require(cfg: AzureBlobConfig) -> None:
    if not cfg.account or not cfg.key or not cfg.container:
        raise RuntimeError("Azure Blob storage is not configured (AZURE_STORAGE_ACCOUNT/AZURE_STORAGE_KEY/AZURE_BLOB_CONTAINER)")


def make_upload_url(cfg: AzureBlobConfig, blob_key: str, *, ttl_seconds: int = 15 * 60) -> str:
    _require(cfg)
    sas = generate_blob_sas(
        account_name=cfg.account,
        container_name=cfg.container,
        blob_name=blob_key,
        account_key=cfg.key,
        permission=BlobSasPermissions(create=True, write=True, add=True),
        expiry=_now() + ttl_seconds,
    )
    return f"https://{cfg.account}.blob.core.windows.net/{cfg.container}/{blob_key}?{sas}"


def make_download_url(cfg: AzureBlobConfig, blob_key: str, *, ttl_seconds: int = 15 * 60, content_type: Optional[str] = None) -> str:
    _require(cfg)
    sas = generate_blob_sas(
        account_name=cfg.account,
        container_name=cfg.container,
        blob_name=blob_key,
        account_key=cfg.key,
        permission=BlobSasPermissions(read=True),
        expiry=_now() + ttl_seconds,
        content_type=content_type,
    )
    return f"https://{cfg.account}.blob.core.windows.net/{cfg.container}/{blob_key}?{sas}"
