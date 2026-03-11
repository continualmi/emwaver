import { getAuth } from "firebase-admin/auth";
import { NextResponse, type NextRequest } from "next/server";

import { getFirebaseAdminApp } from "@/server/auth";
import { authHandoffStore } from "@/server/store/authHandoff";

export async function POST(request: NextRequest) {
  let adminApp;
  try {
    adminApp = getFirebaseAdminApp();
  } catch {
    return NextResponse.json(
      {
        error: "not_configured",
        detail: "Backend is missing FIREBASE_ADMIN_JSON_B64 (Firebase Admin service account JSON, base64).",
      },
      { status: 503 },
    );
  }

  const payload = await request.json().catch(() => null);
  const code = String((payload as Record<string, unknown> | null)?.code || "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  const result = authHandoffStore.consume(code);
  if ("error" in result) {
    const status = result.error === "already_consumed" ? 409 : result.error === "expired" ? 410 : 404;
    return NextResponse.json({ error: result.error }, { status });
  }

  try {
    const token = await getAuth(adminApp).createCustomToken(result.firebase_uid);
    return NextResponse.json({ firebase_custom_token: token, uid: result.firebase_uid });
  } catch (error) {
    return NextResponse.json({ error: "token_mint_failed", detail: String(error) }, { status: 502 });
  }
}
