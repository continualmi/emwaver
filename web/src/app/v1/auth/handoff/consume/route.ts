import { NextResponse, type NextRequest } from "next/server";

import { verifyContinualHandoffToken } from "@/server/continualHandoff";
import { getContinualPlatformUrl } from "@/server/env";
import { createSessionToken } from "@/server/session";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const code = String((payload as Record<string, unknown> | null)?.code || "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  try {
    const response = await fetch(new URL("/api/auth/handoff/code/consume", getContinualPlatformUrl()), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ code, product: "emwaver" }),
      cache: "no-store",
    });
    const json = (await response.json().catch(() => null)) as { handoff_token?: string; error?: string } | null;
    if (!response.ok) {
      return NextResponse.json({ error: json?.error || "handoff_consume_failed" }, { status: response.status });
    }

    const handoffToken = String(json?.handoff_token || "").trim();
    const user = verifyContinualHandoffToken(handoffToken);
    if (!user) {
      return NextResponse.json({ error: "invalid_handoff_token" }, { status: 502 });
    }

    const accessToken = createSessionToken(user);
    return NextResponse.json({
      access_token: accessToken,
      user: {
        uid: user.uid,
        email: user.email ?? null,
        name: user.name ?? null,
        status: user.status,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "handoff_consume_failed", detail: String(error) }, { status: 502 });
  }
}
