import Link from "next/link";
import { backendBaseUrl } from "@/lib/backend";

export const dynamic = "force-dynamic";

type SocietyPost = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  created_at_ms: number;
};

async function fetchVideos(): Promise<SocietyPost[]> {
  const url = new URL(`${backendBaseUrl()}/v1/society/posts`);
  url.searchParams.set("kind", "video");
  const res = await fetch(url.toString(), { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return (json.posts || []) as SocietyPost[];
}

export default async function SocietyVideosPage() {
  const videos = await fetchVideos();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Hosted</div>
          <div className="mt-1 text-sm text-[color:var(--ink-dim)]">
            Videos are hosted by EMWaver Society.
          </div>
        </div>

        <Link
          href="/signin?redirect=/society/videos"
          className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
        >
          Sign in
        </Link>
      </div>

      {videos.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-5 backdrop-blur-md">
          <div className="text-sm font-semibold text-[color:var(--ink)]">No videos yet</div>
          <p className="mt-2 text-sm text-[color:var(--ink-dim)]">
            We&apos;ll publish bring-up demos and deep dives here.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {videos.map((v) => (
            <Link
              key={v.id}
              href={`/society/posts/${encodeURIComponent(v.id)}`}
              className="block rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-5 backdrop-blur-md hover:bg-[rgba(255,255,255,0.05)]"
            >
              <div className="text-lg font-semibold text-[color:var(--ink)]">{v.title}</div>
              {v.summary ? <div className="mt-2 text-sm text-[color:var(--ink-dim)]">{v.summary}</div> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
