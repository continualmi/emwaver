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

async function fetchScripts(): Promise<SocietyPost[]> {
  const url = new URL(`${backendBaseUrl()}/v1/society/posts`);
  url.searchParams.set("kind", "script");
  const res = await fetch(url.toString(), { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return (json.posts || []) as SocietyPost[];
}

export default async function SocietyScriptsPage() {
  const scripts = await fetchScripts();
  const namingIdeas = [
    "EMWaver Flows",
    "EMWaver Routines",
    "EMWaver Patches",
    "EMWaver Labs",
    "EMWaver Scenes",
    "EMWaver Runs",
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-4 backdrop-blur-md">
        <div>
          <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Library</div>
          <div className="mt-1 text-sm text-[color:var(--ink-dim)]">
            Share runnable <span className="font-mono">.emw</span> scripts with the community.
          </div>
        </div>

        <Link
          href="/signin?redirect=/society/scripts"
          className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] hover:opacity-95"
        >
          Sign in to publish
        </Link>
      </div>

      <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] p-4 backdrop-blur-md">
        <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">Branding ideas</div>
        <p className="mt-1 text-sm text-[color:var(--ink-dim)]">
          Alternatives to &ldquo;EMWaver Scripts&rdquo; you can explore for this section:
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {namingIdeas.map((name) => (
            <span
              key={name}
              className="inline-flex items-center rounded-full border border-[color:var(--line)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-sm font-medium text-[color:var(--ink)]"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      {scripts.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-5 backdrop-blur-md">
          <div className="text-sm font-semibold text-[color:var(--ink)]">No scripts published yet</div>
          <p className="mt-2 text-sm text-[color:var(--ink-dim)]">
            First wave will be curated. Then we&apos;ll open submissions.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {scripts.map((s) => (
            <Link
              key={s.id}
              href={`/society/posts/${encodeURIComponent(s.id)}`}
              className="block rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-5 backdrop-blur-md hover:bg-[rgba(255,255,255,0.05)]"
            >
              <div className="text-lg font-semibold text-[color:var(--ink)]">{s.title}</div>
              {s.summary ? <div className="mt-2 text-sm text-[color:var(--ink-dim)]">{s.summary}</div> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
