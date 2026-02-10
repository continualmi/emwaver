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

async function fetchThreads(): Promise<SocietyPost[]> {
  const url = new URL(`${backendBaseUrl()}/v1/society/posts`);
  url.searchParams.set("kind", "discussion");
  const res = await fetch(url.toString(), { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return (json.posts || []) as SocietyPost[];
}

export default async function SocietyForumPage() {
  const threads = await fetchThreads();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Discussions</div>
          <div className="mt-1 text-sm text-[color:var(--ink-dim)]">Projects, experiments, and questions.</div>
        </div>

        <Link
          href="/signin?redirect=/society/forum"
          className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
        >
          Sign in to post
        </Link>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-5">
          <div className="text-sm font-semibold text-[color:var(--ink)]">No discussions yet</div>
          <p className="mt-2 text-sm text-[color:var(--ink-dim)]">
            We’ll open posting soon (device-attached accounts only).
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {threads.map((t) => (
            <Link
              key={t.id}
              href={`/society/posts/${encodeURIComponent(t.id)}`}
              className="block rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-5 hover:bg-[rgba(255,255,255,0.05)]"
            >
              <div className="text-lg font-semibold text-[color:var(--ink)]">{t.title}</div>
              {t.summary ? <div className="mt-2 text-sm text-[color:var(--ink-dim)]">{t.summary}</div> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
