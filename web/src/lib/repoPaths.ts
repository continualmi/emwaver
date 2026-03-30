import path from "path";
import { fileURLToPath } from "url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

// Resolve paths from the file location instead of process.cwd() so the app
// still works when the custom server is launched from the repo root.
export const WEB_ROOT = path.resolve(SRC_DIR, "../..");
export const REPO_ROOT = path.resolve(WEB_ROOT, "..");
export const PUBLIC_DIR = path.join(WEB_ROOT, "public");
export const NEWS_POSTS_DIR = path.join(PUBLIC_DIR, "news", "posts");
