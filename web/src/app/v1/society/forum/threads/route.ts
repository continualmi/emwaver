import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { provisionedDevicesStore } from "@/server/store/provisionedDevices";
import { societyStore } from "@/server/store/society";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();
  if (!provisionedDevicesStore.hasUserDevice(identity.uid)) {
    return NextResponse.json({ error: "device_required" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const title = String((payload as Record<string, unknown> | null)?.title || "").trim();
  const bodyMd = String((payload as Record<string, unknown> | null)?.body_md || "").trim();
  const summary = String((payload as Record<string, unknown> | null)?.summary || "").trim();

  if (!title) return NextResponse.json({ error: "missing_title" }, { status: 400 });
  if (title.length > 256) return NextResponse.json({ error: "title_too_long" }, { status: 400 });
  if (!bodyMd) return NextResponse.json({ error: "missing_body_md" }, { status: 400 });
  if (bodyMd.length > 60_000) return NextResponse.json({ error: "body_too_long" }, { status: 400 });
  if (summary.length > 512) return NextResponse.json({ error: "summary_too_long" }, { status: 400 });

  const post = societyStore.createThread({
    title,
    summary,
    body_md: bodyMd,
    firebase_uid: identity.uid,
    author_email: identity.email || null,
    author_display_name: identity.displayName || null,
  });

  return NextResponse.json({ post }, { status: 201 });
}
