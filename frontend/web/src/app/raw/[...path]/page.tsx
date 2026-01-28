import { notFound } from "next/navigation";

export default async function RawDocPage({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path: parts = [] } = await params;
  if (parts.length === 0) return notFound();

  const relPath = parts.join("/");
  const src = `/_docs/${relPath}`;
  return (
    <div className="overflow-hidden rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-4 border-b border-[color:var(--line)] bg-[rgba(6,8,16,0.6)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[color:var(--ink)]">
            {relPath}
          </div>
          <div className="truncate text-xs text-[color:var(--ink-dim)]">
            Legacy page (served from docs during transition)
          </div>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
        >
          Open raw
        </a>
      </div>

      <iframe
        title={relPath}
        src={src}
        className="h-[calc(100dvh-220px)] w-full bg-white"
      />
    </div>
  );
}
