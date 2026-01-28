import fs from "fs/promises";
import path from "path";
import YAML from "yaml";
import { REPO_ROOT } from "@/lib/repoPaths";

export type NavItem =
  | {
      type: "link";
      title: string;
      href: string;
    }
  | {
      type: "group";
      title: string;
      items: NavItem[];
    };

function normalizeHref(raw: string): string {
  // mkdocs.yml uses paths relative to docs/content.
  // We expose them under /docs (for md) and /raw (for html).
  if (raw.endsWith(".md")) {
    const clean = raw.replace(/\.md$/, "");
    return `/docs/${clean}`;
  }
  if (raw.endsWith(".html")) {
    return `/raw/${raw}`;
  }
  // Treat as folder-ish.
  return `/docs/${raw}`;
}

function toNavItems(node: unknown): NavItem[] {
  if (!Array.isArray(node)) return [];

  const out: NavItem[] = [];
  for (const entry of node) {
    if (typeof entry === "string") {
      out.push({ type: "link", title: entry, href: normalizeHref(entry) });
      continue;
    }

    if (entry && typeof entry === "object") {
      const keys = Object.keys(entry as Record<string, unknown>);
      if (keys.length !== 1) continue;
      const title = keys[0] ?? "";
      const value = (entry as Record<string, unknown>)[title];
      if (typeof value === "string") {
        out.push({ type: "link", title, href: normalizeHref(value) });
      } else {
        out.push({ type: "group", title, items: toNavItems(value) });
      }
    }
  }
  return out;
}

export async function loadMkdocsNav(): Promise<NavItem[]> {
  const mkdocsPath = path.join(REPO_ROOT, "docs", "mkdocs.yml");
  let raw = await fs.readFile(mkdocsPath, "utf-8");
  // mkdocs.yml contains some Python-tagged values (MkDocs Material config).
  // We only need `nav`, so we sanitize these tags to keep YAML parsing quiet.
  raw = raw.replace(/!!python\/name:([\w.]+)/g, '"$1"');
  const parsed = YAML.parse(raw) as { nav?: unknown };
  return toNavItems(parsed.nav);
}
