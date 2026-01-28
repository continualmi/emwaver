import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";

function isExternalHref(href: string): boolean {
  return (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  );
}

function toDocsRouteFromMd(href: string): string | null {
  // MkDocs-style relative links like: hardware/device.md
  if (href.endsWith(".md")) {
    const clean = href.replace(/^\.\//, "").replace(/\.md$/, "");
    return `/docs/${clean}`;
  }
  return null;
}

function toDocsAssetRoute(href: string): string {
  // During transition, serve from docs/content via /_docs.
  const clean = href.replace(/^\.\//, "");
  return `/_docs/${clean}`;
}

function rewriteHtmlLinks(html: string): string {
  // Minimal, conservative rewriting (keeps HTML as string for now).
  // - .md links -> /docs/...
  // - relative asset src/href -> /_docs/...
  return html
    .replace(/href=("|')([^"']+)("|')/g, (m, q1, href, q2) => {
      if (typeof href !== "string") return m;
      if (isExternalHref(href) || href.startsWith("#")) return m;
      const mdRoute = toDocsRouteFromMd(href);
      if (mdRoute) return `href=${q1}${mdRoute}${q2}`;
      if (href.startsWith("/")) return m;
      if (href.endsWith(".html")) {
        const clean = href.replace(/^\.\//, "");
        return `href=${q1}/raw/${clean}${q2}`;
      }
      return `href=${q1}${toDocsAssetRoute(href)}${q2}`;
    })
    .replace(/src=("|')([^"']+)("|')/g, (m, q1, src, q2) => {
      if (typeof src !== "string") return m;
      if (isExternalHref(src) || src.startsWith("data:")) return m;
      if (src.startsWith("/")) return m;
      return `src=${q1}${toDocsAssetRoute(src)}${q2}`;
    });
}

export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: "wrap",
      properties: {
        className: ["anchor"],
      },
    })
    .use(rehypeHighlight)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return rewriteHtmlLinks(String(file));
}
