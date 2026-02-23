# Secrets Layout (single source-of-truth, minimal duplication)

This folder is organized by responsibility:

- `shared/`   -> values reused by multiple targets
- `server/`   -> backend-only sensitive config
- `targets/`  -> target-specific overlays (frontend/apps/securewaver/etc.)
- `ci/`       -> CI/CD deployment secrets

## Suggested load order

1. `shared/*.env`
2. role-specific group (`server/*.env` or `ci/*.env`)
3. target overlay from `targets/*.env`

Later files override earlier ones.

## Notes

- `EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64` is backend-only.
- `EMWAVER_ROOT_PUBLIC_KEY_B64` is public and safe for client apps.
- `NEXT_PUBLIC_*` and `VITE_*` are bundled into client apps at build time.
