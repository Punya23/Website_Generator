/** Tracks per-agent mock/LLM fallbacks during a generation run. */

export type FallbackAgent =
  | "copywriter"
  | "media_curator"
  | "palette"
  | "typography"
  | "nav_surface"
  | "creative_director"
  | "site_architect"
  | "expand_brief"
  | "site_planner"
  | "design_refine"
  | "chrome_director"
  | "motion_director"
  | "layout_director"
  | "section_codegen"
  | "section_props"
  | "page_codegen";

const counts: Record<string, number> = {};

export function resetFallbackTracker(): void {
  for (const key of Object.keys(counts)) delete counts[key];
}

export function recordFallback(agent: FallbackAgent, sectionId?: string): void {
  const key = sectionId ? `${agent}:${sectionId}` : agent;
  counts[key] = (counts[key] ?? 0) + 1;
  counts[agent] = (counts[agent] ?? 0) + 1;
}

export function getFallbackSummary(): Record<string, number> {
  const agentsOnly: Record<string, number> = {};
  for (const [key, n] of Object.entries(counts)) {
    if (!key.includes(":")) agentsOnly[key] = n;
  }
  return agentsOnly;
}

export function totalFallbacks(): number {
  return Object.entries(counts)
    .filter(([key]) => !key.includes(":"))
    .reduce((sum, [, n]) => sum + n, 0);
}
