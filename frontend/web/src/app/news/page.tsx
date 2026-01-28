import fs from "fs/promises";
import path from "path";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { DOCS_CONTENT_DIR } from "@/lib/repoPaths";

type Post = {
  href: string;
  title: string;
  date: string;
};

function pick(regex: RegExp, text: string): string | null {
  const m = text.match(regex);
  return m?.[1]?.trim() ?? null;
}

async function loadPosts(): Promise<Post[]> {
  const postsDir = path.join(DOCS_CONTENT_DIR, "news", "posts");
  const names = (await fs.readdir(postsDir)).filter((n) => n.endsWith(".html"));

  const posts: Post[] = [];
  for (const name of names) {
    const filePath = path.join(postsDir, name);
    const raw = await fs.readFile(filePath, "utf-8");

    const title =
      pick(/<article[^>]*>[\s\S]*?<h1>([^<]+)<\/h1>/i, raw) ??
      pick(/<title>([^<]+)<\/title>/i, raw) ??
      name;
    const date = pick(
      /<div\s+class=(?:"|')post-date(?:"|')>([^<]+)<\/div>/i,
      raw,
    ) ?? "";

    posts.push({
      href: `/raw/news/posts/${name}`,
      title: title.replace(/\s+-\s+EMWaver News\s*$/i, ""),
      date,
    });
  }

  // Keep deterministic; newest-first is not guaranteed by filename.
  // If date missing, it sorts last.
  posts.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return posts;
}

export default async function NewsPage() {
  const posts = await loadPosts();

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-10">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
                News
              </h1>
              <p className="pt-2 text-[15px] text-[color:var(--ink-dim)]">
                Updates, release notes, and platform direction.
              </p>
            </div>
            <Link
              href="/docs/overview"
              className="hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)] md:inline-flex"
            >
              Docs
            </Link>
          </div>

          <div className="mt-8 grid gap-4">
            {posts.length === 0 ? (
              <div className="text-sm text-[color:var(--ink-dim)]">
                No posts yet.
              </div>
            ) : (
              posts.map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  className="group rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-baseline md:justify-between">
                    <div className="text-lg font-semibold text-[color:var(--ink)]">
                      {p.title}
                    </div>
                    <div className="text-sm text-[color:var(--ink-dim)]">
                      {p.date}
                    </div>
                  </div>
                  <div className="pt-2 text-sm text-[color:var(--ink-dim)]">
                    Read post
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
