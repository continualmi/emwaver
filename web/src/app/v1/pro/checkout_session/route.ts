import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { createContinualProCheckoutSession, getPlatformUserById } from "@/server/platformCore";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  if (!(process.env.STRIPE_WEBHOOK_SECRET || "").trim()) {
    return NextResponse.json({ error: "pro_not_configured" }, { status: 503 });
  }
  try {
    const user = await getPlatformUserById(identity.uid);
    if (!user) return NextResponse.json({ error: "unknown_user" }, { status: 404 });
    const session = await createContinualProCheckoutSession(user);
    return NextResponse.json({ url: session.url, session_id: session.id });
  } catch (error) {
    return NextResponse.json({ error: "stripe_error", detail: String(error) }, { status: 502 });
  }
}
