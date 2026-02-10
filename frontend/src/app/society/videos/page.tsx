export const dynamic = "force-dynamic";

export default async function SocietyVideosPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-2xl font-semibold text-[color:var(--ink)]">Videos</h1>
      <p className="mt-3 text-sm text-[color:var(--ink-dim)]">
        EMWaver-hosted videos. No YouTube.
      </p>

      <div className="mt-8 rounded-xl border border-[color:var(--line)] bg-[rgba(2,3,8,0.35)] p-5">
        <div className="text-sm font-semibold text-[color:var(--ink)]">Coming soon</div>
        <p className="mt-2 text-sm text-[color:var(--ink-dim)]">
          This section will host EMWaver Society videos directly.
        </p>
      </div>
    </main>
  );
}
