"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NEWS_POSTS } from "@/lib/newsPosts";

function isActive(pathname: string, href: string) {
  return pathname === href;
}

export function NewsSidebar() {
  const pathname = usePathname();

  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-4 backdrop-blur">
      <div className="mb-3 text-xs font-semibold tracking-wide text-[color:var(--ink)]">
        News
      </div>

      <div className="space-y-1">
        <Link
          href="/news"
          className={
            "block rounded-xl px-3 py-2 text-sm font-semibold transition " +
            (isActive(pathname, "/news")
              ? "bg-[color:var(--surface)] text-[color:var(--ink)]"
              : "text-[color:var(--ink-dim)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[color:var(--ink)]")
          }
        >
          All posts
        </Link>

        <div className="my-3 border-t border-[color:var(--line)]" />

        {NEWS_POSTS.map((post) => {
          const href = `/news/${post.slug}`;
          const active = isActive(pathname, href);
          return (
            <Link
              key={post.slug}
              href={href}
              className={
                "block rounded-xl px-3 py-2 text-sm transition " +
                (active
                  ? "bg-[color:var(--surface)] text-[color:var(--ink)]"
                  : "text-[color:var(--ink-dim)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[color:var(--ink)]")
              }
            >
              <div className="font-semibold">{post.title}</div>
              <div className="pt-0.5 text-[12px] leading-5 text-[color:var(--ink-dim)]">
                {post.date}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
