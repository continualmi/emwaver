import path from "path";

// Next project root is repo-root/web.
export const WEB_ROOT = process.cwd();
export const PUBLIC_DIR = path.join(WEB_ROOT, "public");
export const NEWS_POSTS_DIR = path.join(PUBLIC_DIR, "news", "posts");
