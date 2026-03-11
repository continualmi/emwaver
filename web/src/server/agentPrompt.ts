import { readFileSync } from "node:fs";
import path from "node:path";

export function loadRepoAgentSystemPrompt(): string | null {
  const promptPath = path.resolve(process.cwd(), "..", "AGENT_SYSTEM_PROMPT.md");
  try {
    const text = readFileSync(promptPath, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}
