import Link from "next/link";
import { backendBaseUrl } from "@/lib/backend";

export const dynamic = "force-dynamic";

type SocietyPost = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  body_md?: string;
  created_at_ms: number;
  author?: { display_name?: string | null };
};

type SocietyComment = {
  id: string;
  body_md: string;
  created_at_ms: number;
  author?: { display_name?: string | null };
};

async function fetchPost(id: string): Promise<SocietyPost> {
  const res = await fetch(`${backendBaseUrl()}/v1/society/posts/${encodeURIComponent(id)}`, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return json.post as SocietyPost;
}

async function fetchComments(id: string): Promise<SocietyComment[]> {
  const res = await fetch(`${backendBaseUrl()}/v1/society/posts/${encodeURIComponent(id)}/comments`, {
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return (json.comments || []) as SocietyComment[];
}

function mdToText(md: string) {
  return (md || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .trim();
}

export default async function SocietyPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [post, comments] = await Promise.all([fetchPost(id), fetchComments(id)]);

  return (
    <div className="space-y-6">
      <Link href="/society" className="text-sm font-semibold text-[color:var(--ink-dim)] hover:text-[color:var(--ink)]">
        ← Back
      </Link>

      <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-6">
        <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">{post.kind}</div>
        <div className="mt-2 text-2xl font-semibold text-[color:var(--ink)]">{post.title}</div>
        {post.summary ? <div className="mt-2 text-sm text-[color:var(--ink-dim)]">{post.summary}</div> : null}

        {post.body_md ? (
          <div className="mt-6 whitespace-pre-wrap text-sm leading-7 text-[color:var(--ink-dim)]">
            {mdToText(post.body_md)}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-semibold text-[color:var(--ink)]">Comments</div>
          <Link
            href={`/signin?redirect=${encodeURIComponent(`/society/posts/${id}`)}`}
            className="text-sm font-semibold text-[color:var(--ink-dim)] hover:text-[color:var(--ink)]"
          >
            Sign in to comment
          </Link>
        </div>

        {comments.length === 0 ? (
          <div className="mt-3 text-sm text-[color:var(--ink-dim)]">No comments yet.</div>
        ) : (
          <div className="mt-4 space-y-3">
            {comments.map((c) => (
              <div key={c.id} className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4">
                <div className="text-xs font-semibold text-[color:var(--ink-dim)]">
                  {c.author?.display_name || "Member"}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-[color:var(--ink-dim)]">{mdToText(c.body_md)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
