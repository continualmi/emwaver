import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@/lib/repoPaths";

export function loadRepoAgentSystemPrompt(): string | null {
  const promptPath = path.resolve(REPO_ROOT, "AGENT_SYSTEM_PROMPT.md");
  try {
    const text = readFileSync(promptPath, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}
