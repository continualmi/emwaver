import { NextResponse } from "next/server";

import { env, hasEnv } from "@/server/env";

export function GET() {
  return NextResponse.json({
    ok: true,
    auth: {
      mode: (process.env.EMWAVER_AUTH_MODE || "enabled").trim().toLowerCase(),
      firebase_project_id_configured: Boolean(env.firebaseProjectId),
      firebase_admin_json_b64_configured: hasEnv("FIREBASE_ADMIN_JSON_B64"),
      firebase_service_account_json_configured: hasEnv("FIREBASE_SERVICE_ACCOUNT_JSON"),
      handoff_token_mint_ready: hasEnv("FIREBASE_ADMIN_JSON_B64"),
    },
    storage: {
      database_url_configured: hasEnv("DATABASE_URL"),
      azure_storage_account_configured: hasEnv("AZURE_STORAGE_ACCOUNT"),
      azure_storage_key_configured: hasEnv("AZURE_STORAGE_KEY"),
      azure_blob_container_configured: hasEnv("AZURE_BLOB_CONTAINER"),
    },
  });
}
