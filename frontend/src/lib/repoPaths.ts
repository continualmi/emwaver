import path from "path";

// Next project root is repo-root/frontend.
export const FRONTEND_ROOT = process.cwd();
export const PUBLIC_DIR = path.join(FRONTEND_ROOT, "public");
export const NEWS_POSTS_DIR = path.join(PUBLIC_DIR, "news", "posts");
