import type { GenerationResult } from "../types.js";

let activeSession: GenerationResult | null = null;

export function setEditorSession(result: GenerationResult): void {
  activeSession = result;
}

export function getEditorSession(): GenerationResult | null {
  return activeSession;
}

export function updateEditorSession(mutator: (session: GenerationResult) => void): GenerationResult {
  if (!activeSession) throw new Error("No active site session — generate a site first");
  mutator(activeSession);
  return activeSession;
}
