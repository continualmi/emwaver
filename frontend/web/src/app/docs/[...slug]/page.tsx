import fs from "fs/promises";
import { notFound } from "next/navigation";
import { resolveDocBySlug } from "@/lib/docs/resolve";
import { renderMarkdownToHtml } from "@/lib/docs/markdown";

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const resolved = await resolveDocBySlug(slug);
  if (!resolved) return notFound();

  const raw = await fs.readFile(resolved.filePath, "utf-8");
  if (resolved.kind === "markdown") {
    const html = await renderMarkdownToHtml(raw);
    return (
      <article
        className="prose-emw"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // HTML docs pages (rare): render inside our chrome.
  // We keep it in an iframe-like boundary by scoping with a container.
  const html = raw
    // Fix relative links to point to the transition asset route.
    .replace(/(src|href)=("|')([^"']+)("|')/g, (m, attr, q1, v, q2) => {
      if (typeof v !== "string") return m;
      if (v.startsWith("http") || v.startsWith("mailto:") || v.startsWith("#")) return m;
      if (v.startsWith("/")) return m;
      if (v.endsWith(".md")) {
        const clean = v.replace(/^\.\//, "").replace(/\.md$/, "");
        return `${attr}=${q1}/docs/${clean}${q2}`;
      }
      return `${attr}=${q1}/_docs/${v.replace(/^\.\//, "")}${q2}`;
    });

  return (
    <article
      className="prose-emw"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
