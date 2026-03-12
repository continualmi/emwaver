#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

env_file="${1:-.env.prod}"
resource_group="${AZURE_RESOURCE_GROUP:-emwaver}"
webapp_name="${EMWAVER_AZURE_WEBAPP_NAME:-emwaver-web}"
vault_name="${EMWAVER_AZURE_KEYVAULT_NAME:-emwaver-kv-0312-luisml}"
location="${EMWAVER_AZURE_LOCATION:-westeurope}"

if [[ ! -f "$env_file" ]]; then
  echo "Missing env file: $env_file" >&2
  exit 1
fi

set -a
source "$env_file"
set +a

echo "Ensuring web app managed identity..."
az webapp identity assign -g "$resource_group" -n "$webapp_name" >/dev/null
web_principal_id="$(az webapp show -g "$resource_group" -n "$webapp_name" --query identity.principalId -o tsv)"

echo "Ensuring Key Vault $vault_name..."
if ! az keyvault show --name "$vault_name" >/dev/null 2>&1; then
  az keyvault create \
    --resource-group "$resource_group" \
    --name "$vault_name" \
    --location "$location" \
    --enable-rbac-authorization true \
    >/dev/null
fi

vault_id="$(az keyvault show --name "$vault_name" --query id -o tsv)"
vault_uri="$(az keyvault show --name "$vault_name" --query properties.vaultUri -o tsv)"

echo "Granting Key Vault access to web app identity..."
az role assignment create \
  --assignee-object-id "$web_principal_id" \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "$vault_id" \
  >/dev/null 2>&1 || true

current_user_object_id="$(az ad signed-in-user show --query id -o tsv)"
az role assignment create \
  --assignee-object-id "$current_user_object_id" \
  --assignee-principal-type User \
  --role "Key Vault Administrator" \
  --scope "$vault_id" \
  >/dev/null 2>&1 || true

set_secret() {
  local env_key="$1"
  local secret_name="$2"
  local value="${!env_key-}"
  if [[ -z "${value}" ]]; then
    return
  fi
  az keyvault secret set \
    --vault-name "$vault_name" \
    --name "$secret_name" \
    --value "$value" \
    >/dev/null
}

set_secret NODE_ENV node-env
set_secret EMWAVER_BACKEND_URL emwaver-backend-url
set_secret EMWAVER_BACKEND_URL_CLOUD emwaver-backend-url-cloud
set_secret EMWAVER_BACKEND_URL_LOCAL emwaver-backend-url-local
set_secret EMWAVER_FRONTEND_URL emwaver-frontend-url
set_secret EMWAVER_FRONTEND_URL_CLOUD emwaver-frontend-url-cloud
set_secret EMWAVER_FRONTEND_URL_LOCAL emwaver-frontend-url-local
set_secret EMWAVER_ALLOW_ANON_SYNC emwaver-allow-anon-sync
set_secret EMWAVER_STAFF_ONLY emwaver-staff-only
set_secret EMWAVER_AUTH_MODE emwaver-auth-mode
set_secret EMWAVER_AUTH_DEBUG emwaver-auth-debug
set_secret EMWAVER_DEFAULT_PRO emwaver-default-pro
set_secret EMWAVER_ROOT_PUBLIC_KEY_B64 emwaver-root-public-key-b64
set_secret EMWAVER_PROVISIONING_ENABLED emwaver-provisioning-enabled
set_secret EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64 emwaver-provisioning-root-private-key-b64
set_secret EMWAVER_PROVISIONING_ALLOWED_UIDS emwaver-provisioning-allowed-uids
set_secret EMWAVER_PROVISIONING_ALLOWED_EMAIL emwaver-provisioning-allowed-email
set_secret EMWAVER_PROVISIONING_MINT_RPM emwaver-provisioning-mint-rpm
set_secret FIREBASE_PROJECT_ID firebase-project-id
set_secret FIREBASE_API_KEY firebase-api-key
set_secret FIREBASE_AUTH_DOMAIN firebase-auth-domain
set_secret FIREBASE_APP_ID firebase-app-id
set_secret FIREBASE_ADMIN_JSON_B64 firebase-admin-json-b64
set_secret FIREBASE_SERVICE_ACCOUNT_JSON firebase-service-account-json
set_secret OPENROUTER_API_KEY openrouter-api-key
set_secret OPENAI_API_KEY openai-api-key
set_secret OPENAI_BASE_URL openai-base-url
set_secret OPENAI_MODEL openai-model
set_secret GEMINI_API_KEY gemini-api-key
set_secret DATABASE_URL database-url
set_secret AZURE_STORAGE_ACCOUNT azure-storage-account
set_secret AZURE_STORAGE_KEY azure-storage-key
set_secret AZURE_BLOB_CONTAINER azure-blob-container
set_secret AZURE_STORAGE_CONNECTION_STRING azure-storage-connection-string
set_secret AZURE_STORAGE_CONTAINER azure-storage-container
set_secret STRIPE_SECRET_KEY stripe-secret-key
set_secret STRIPE_WEBHOOK_SECRET stripe-webhook-secret
set_secret STORE_STRIPE_PRICE_ID store-stripe-price-id
set_secret STORE_SUCCESS_URL store-success-url
set_secret STORE_CANCEL_URL store-cancel-url
set_secret STORE_SHIPPING_COUNTRIES store-shipping-countries
set_secret PRO_STRIPE_PRICE_ID pro-stripe-price-id
set_secret PRO_SUCCESS_URL pro-success-url
set_secret PRO_CANCEL_URL pro-cancel-url
set_secret NEXT_PUBLIC_EMWAVER_BACKEND_URL next-public-emwaver-backend-url
set_secret NEXT_PUBLIC_EMWAVER_BACKEND_URL_CLOUD next-public-emwaver-backend-url-cloud
set_secret NEXT_PUBLIC_EMWAVER_BACKEND_URL_LOCAL next-public-emwaver-backend-url-local
set_secret NEXT_PUBLIC_EMWAVER_STAFF_ONLY next-public-emwaver-staff-only
set_secret NEXT_PUBLIC_FIREBASE_API_KEY next-public-firebase-api-key
set_secret NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN next-public-firebase-auth-domain
set_secret NEXT_PUBLIC_FIREBASE_PROJECT_ID next-public-firebase-project-id
set_secret NEXT_PUBLIC_FIREBASE_APP_ID next-public-firebase-app-id
set_secret NEXT_PUBLIC_SOCIETY_SITE_URL next-public-society-site-url
set_secret SOCIETY_SITE_URL society-site-url

if [[ -n "${DATABASE_URL:-}" ]]; then
  db_password="$(python3 - <<'PY'
import os
from urllib.parse import urlparse
url = os.environ.get("DATABASE_URL", "")
parsed = urlparse(url)
print(parsed.password or "")
PY
)"
  if [[ -n "$db_password" ]]; then
    az keyvault secret set \
      --vault-name "$vault_name" \
      --name database-password \
      --value "$db_password" \
      >/dev/null
  fi
fi

kv_ref() {
  local secret_name="$1"
  printf '@Microsoft.KeyVault(SecretUri=%ssecrets/%s/)' "$vault_uri" "$secret_name"
}

echo "Configuring web app settings to use Key Vault references..."
az webapp config appsettings set \
  --resource-group "$resource_group" \
  --name "$webapp_name" \
  --settings \
    WEBSITES_PORT=3000 \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=false \
    SCM_DO_BUILD_DURING_DEPLOYMENT=false \
    ENABLE_ORYX_BUILD=false \
    NODE_ENV="$(kv_ref node-env)" \
    EMWAVER_BACKEND_URL="$(kv_ref emwaver-backend-url)" \
    EMWAVER_BACKEND_URL_CLOUD="$(kv_ref emwaver-backend-url-cloud)" \
    EMWAVER_BACKEND_URL_LOCAL="$(kv_ref emwaver-backend-url-local)" \
    EMWAVER_FRONTEND_URL="$(kv_ref emwaver-frontend-url)" \
    EMWAVER_FRONTEND_URL_CLOUD="$(kv_ref emwaver-frontend-url-cloud)" \
    EMWAVER_FRONTEND_URL_LOCAL="$(kv_ref emwaver-frontend-url-local)" \
    EMWAVER_ALLOW_ANON_SYNC="$(kv_ref emwaver-allow-anon-sync)" \
    EMWAVER_STAFF_ONLY="$(kv_ref emwaver-staff-only)" \
    EMWAVER_AUTH_MODE="$(kv_ref emwaver-auth-mode)" \
    EMWAVER_AUTH_DEBUG="$(kv_ref emwaver-auth-debug)" \
    EMWAVER_DEFAULT_PRO="$(kv_ref emwaver-default-pro)" \
    EMWAVER_ROOT_PUBLIC_KEY_B64="$(kv_ref emwaver-root-public-key-b64)" \
    EMWAVER_PROVISIONING_ENABLED="$(kv_ref emwaver-provisioning-enabled)" \
    EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64="$(kv_ref emwaver-provisioning-root-private-key-b64)" \
    EMWAVER_PROVISIONING_ALLOWED_UIDS="$(kv_ref emwaver-provisioning-allowed-uids)" \
    EMWAVER_PROVISIONING_ALLOWED_EMAIL="$(kv_ref emwaver-provisioning-allowed-email)" \
    EMWAVER_PROVISIONING_MINT_RPM="$(kv_ref emwaver-provisioning-mint-rpm)" \
    FIREBASE_PROJECT_ID="$(kv_ref firebase-project-id)" \
    FIREBASE_API_KEY="$(kv_ref firebase-api-key)" \
    FIREBASE_AUTH_DOMAIN="$(kv_ref firebase-auth-domain)" \
    FIREBASE_APP_ID="$(kv_ref firebase-app-id)" \
    FIREBASE_ADMIN_JSON_B64="$(kv_ref firebase-admin-json-b64)" \
    FIREBASE_SERVICE_ACCOUNT_JSON="$(kv_ref firebase-service-account-json)" \
    OPENROUTER_API_KEY="$(kv_ref openrouter-api-key)" \
    OPENAI_API_KEY="$(kv_ref openai-api-key)" \
    OPENAI_BASE_URL="$(kv_ref openai-base-url)" \
    OPENAI_MODEL="$(kv_ref openai-model)" \
    GEMINI_API_KEY="$(kv_ref gemini-api-key)" \
    DATABASE_URL="$(kv_ref database-url)" \
    AZURE_STORAGE_ACCOUNT="$(kv_ref azure-storage-account)" \
    AZURE_STORAGE_KEY="$(kv_ref azure-storage-key)" \
    AZURE_BLOB_CONTAINER="$(kv_ref azure-blob-container)" \
    AZURE_STORAGE_CONNECTION_STRING="$(kv_ref azure-storage-connection-string)" \
    AZURE_STORAGE_CONTAINER="$(kv_ref azure-storage-container)" \
    STRIPE_SECRET_KEY="$(kv_ref stripe-secret-key)" \
    STRIPE_WEBHOOK_SECRET="$(kv_ref stripe-webhook-secret)" \
    STORE_STRIPE_PRICE_ID="$(kv_ref store-stripe-price-id)" \
    STORE_SUCCESS_URL="$(kv_ref store-success-url)" \
    STORE_CANCEL_URL="$(kv_ref store-cancel-url)" \
    STORE_SHIPPING_COUNTRIES="$(kv_ref store-shipping-countries)" \
    PRO_STRIPE_PRICE_ID="$(kv_ref pro-stripe-price-id)" \
    PRO_SUCCESS_URL="$(kv_ref pro-success-url)" \
    PRO_CANCEL_URL="$(kv_ref pro-cancel-url)" \
    NEXT_PUBLIC_EMWAVER_BACKEND_URL="$(kv_ref next-public-emwaver-backend-url)" \
    NEXT_PUBLIC_EMWAVER_BACKEND_URL_CLOUD="$(kv_ref next-public-emwaver-backend-url-cloud)" \
    NEXT_PUBLIC_EMWAVER_BACKEND_URL_LOCAL="$(kv_ref next-public-emwaver-backend-url-local)" \
    NEXT_PUBLIC_EMWAVER_STAFF_ONLY="$(kv_ref next-public-emwaver-staff-only)" \
    NEXT_PUBLIC_FIREBASE_API_KEY="$(kv_ref next-public-firebase-api-key)" \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="$(kv_ref next-public-firebase-auth-domain)" \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID="$(kv_ref next-public-firebase-project-id)" \
    NEXT_PUBLIC_FIREBASE_APP_ID="$(kv_ref next-public-firebase-app-id)" \
    NEXT_PUBLIC_SOCIETY_SITE_URL="$(kv_ref next-public-society-site-url)" \
    SOCIETY_SITE_URL="$(kv_ref society-site-url)" \
  >/dev/null

echo "Configured Key Vault $vault_name and updated $webapp_name."
