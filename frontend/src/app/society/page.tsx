import Link from "next/link";
import { backendBaseUrl } from "@/lib/backend";

export const dynamic = "force-dynamic";

type SocietyPost = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  created_at_ms: number;
  author?: { display_name?: string | null };
};

function buildSocietyPostsUrl(kind?: string): string {
  const rawBase = (backendBaseUrl() || "").trim();
  const fallback = "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io";
  const base = (rawBase || fallback).replace(/\/+$/, "");
  const url = new URL(`${base}/v1/society/posts`);
  if (kind) url.searchParams.set("kind", kind);
  return url.toString();
}

async function fetchPosts(kind?: string): Promise<SocietyPost[]> {
  const res = await fetch(buildSocietyPostsUrl(kind), { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return (json.posts || []) as SocietyPost[];
}

export default async function SocietyPage() {
  let posts: SocietyPost[] = [];
  try {
    posts = await fetchPosts();
  } catch {
    posts = [];
  }

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Latest</div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-5">
          <div className="text-sm font-semibold text-[color:var(--ink)]">No posts yet</div>
          <p className="mt-2 text-sm text-[color:var(--ink-dim)]">
            EMWaver Society is live, but we haven’t published posts yet.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/society/scripts"
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
            >
              Browse scripts
            </Link>
            <Link
              href="/society/videos"
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
            >
              Browse videos
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {posts.map((p) => (
            <Link
              key={p.id}
              href={`/society/posts/${encodeURIComponent(p.id)}`}
              className="block rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-5 hover:bg-[rgba(255,255,255,0.05)]"
            >
              <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{p.kind}</div>
              <div className="mt-2 text-lg font-semibold text-[color:var(--ink)]">{p.title}</div>
              {p.summary ? (
                <div className="mt-2 text-sm text-[color:var(--ink-dim)]">{p.summary}</div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
