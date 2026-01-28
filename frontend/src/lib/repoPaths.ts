import path from "path";

// Next project root is repo-root/frontend.
export const REPO_ROOT = path.resolve(process.cwd(), "..");
export const DOCS_CONTENT_DIR = path.join(REPO_ROOT, "docs", "content");
