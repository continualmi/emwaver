import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { createContinualProCheckoutSession, ensurePlatformUser } from "@/server/platformCore";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  if (!(process.env.STRIPE_WEBHOOK_SECRET || "").trim()) {
    return NextResponse.json({ error: "pro_not_configured" }, { status: 503 });
  }
  try {
    const user = await ensurePlatformUser({
      firebaseUid: identity.uid,
      email: identity.email ?? null,
      displayName: identity.displayName ?? null,
    });
    const session = await createContinualProCheckoutSession(user);
    return NextResponse.json({ url: session.url, session_id: session.id });
  } catch (error) {
    return NextResponse.json({ error: "stripe_error", detail: String(error) }, { status: 502 });
  }
}
