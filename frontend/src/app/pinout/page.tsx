import fs from "fs/promises";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { renderMarkdownToHtml } from "@/lib/docs/markdown";
import { resolveDocBySlug } from "@/lib/docs/resolve";

export default async function PinoutPage() {
  const resolved = await resolveDocBySlug(["hardware", "pinout"]);
  if (!resolved) return notFound();

  const raw = await fs.readFile(resolved.filePath, "utf-8");
  const html = await renderMarkdownToHtml(raw);

  return (
    <div className="min-h-dvh docs-mode">
      <SiteHeader />

      <div className="mx-auto max-w-6xl px-5 pt-8">
        <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.55)] p-2 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/pinout"
              className="rounded-xl bg-[color:var(--surface)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)]"
            >
              Pinout
            </Link>
            <Link
              href="/scripts"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface)]"
            >
              Scripts
            </Link>
            <Link
              href="/order"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface)]"
            >
              Order
            </Link>
            <Link
              href="/history"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface)]"
            >
              History
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-10">
          <article className="prose-emw" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
