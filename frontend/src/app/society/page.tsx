export const dynamic = "force-dynamic";

export default async function SocietyPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-2xl font-semibold text-[color:var(--ink)]">EMWaver Society</h1>
      <p className="mt-3 text-sm text-[color:var(--ink-dim)]">
        Community posts, scripts, and announcements.
      </p>

      <div className="mt-8 rounded-xl border border-[color:var(--line)] bg-[rgba(2,3,8,0.35)] p-5">
        <div className="text-sm font-semibold text-[color:var(--ink)]">Coming online</div>
        <p className="mt-2 text-sm text-[color:var(--ink-dim)]">
          We’re wiring up the EMWaver Society backend now. This page will become the home for
          announcements, community scripts, and discussions.
        </p>
      </div>
    </main>
  );
}
