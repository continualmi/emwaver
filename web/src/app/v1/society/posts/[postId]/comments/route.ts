import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { devicesStore } from "@/server/store/devices";
import { societyStore } from "@/server/store/society";

type Context = { params: Promise<{ postId: string }> };

function parseIntBounded(raw: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(raw || "", 10);
  const value = Number.isNaN(parsed) ? fallback : parsed;
  return Math.max(min, Math.min(max, value));
}

export async function GET(request: NextRequest, context: Context) {
  const { postId } = await context.params;
  const post = societyStore.getPost(postId);
  if (!post || !post.published) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const limit = parseIntBounded(request.nextUrl.searchParams.get("limit"), 50, 1, 200);
  return NextResponse.json({ comments: societyStore.listComments(postId, limit) });
}

export async function POST(request: NextRequest, context: Context) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const { postId } = await context.params;
  const post = societyStore.getPost(postId);
  if (!post || !post.published) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (post.locked) {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }
  if (!devicesStore.hasUserDevice(identity.uid)) {
    return NextResponse.json({ error: "device_required" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const bodyMd = String((payload as Record<string, unknown> | null)?.body_md || "").trim();
  if (!bodyMd) {
    return NextResponse.json({ error: "missing_body_md" }, { status: 400 });
  }
  if (bodyMd.length > 20_000) {
    return NextResponse.json({ error: "body_too_long" }, { status: 400 });
  }

  const comment = societyStore.createComment({
    post_id: postId,
    firebase_uid: identity.uid,
    author_email: identity.email || null,
    author_display_name: identity.displayName || null,
    body_md: bodyMd,
  });
  return NextResponse.json({ comment }, { status: 201 });
}
