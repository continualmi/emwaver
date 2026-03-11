import { NextResponse } from "next/server";

import { societyStore } from "@/server/store/society";

type Context = { params: Promise<{ postId: string }> };

export async function GET(_: Request, context: Context) {
  const { postId } = await context.params;
  const post = societyStore.getPost(postId);
  if (!post || !post.published) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ post });
}
