import Link from "next/link";
import { NEWS_POSTS } from "@/lib/emwaver/newsPosts";

export default async function NewsPage() {
  return (
    <>
      <h1>News</h1>
      <p>Updates, release notes, and platform direction.</p>

      <div className="not-prose mt-8 grid gap-4">
        {NEWS_POSTS.length === 0 ? (
          <div className="text-sm text-[color:var(--ink-dim)]">No posts yet.</div>
        ) : (
          NEWS_POSTS.map((p) => (
            <Link
              key={p.slug}
              href={`/news/${p.slug}`}
              className="group block rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 !border-b-0 hover:bg-[color:var(--surface-2)]"
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-baseline md:justify-between">
                <div className="text-lg font-semibold text-[color:var(--ink)]">
                  {p.title}
                </div>
                <div className="text-sm text-[color:var(--ink-dim)]">{p.date}</div>
              </div>
              <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                {p.summary}
              </div>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
