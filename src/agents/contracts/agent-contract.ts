import type { z } from "zod";
import { normalizeAgentPayload } from "../../llm/normalize-llm-output.js";

export interface AgentContract<TOutput> {
  name: string;
  role: string;
  outputSchema: z.ZodType<TOutput>;
  forbiddenFields: string[];
}

export function assertNoForbiddenFields(
  output: Record<string, unknown>,
  forbidden: string[],
  agentName: string
): void {
  for (const key of forbidden) {
    if (key in output) {
      throw new Error(`${agentName} output must not include forbidden field: ${key}`);
    }
  }
}

export function deepHasForbiddenKey(obj: unknown, forbidden: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = deepHasForbiddenKey(item, forbidden);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (forbidden.includes(key)) return key;
    const nested = deepHasForbiddenKey((obj as Record<string, unknown>)[key], forbidden);
    if (nested) return nested;
  }
  return null;
}

export function unwrapAgentPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  if (obj.props && typeof obj.props === "object" && !Array.isArray(obj.props)) {
    return obj.props;
  }
  for (const key of ["palette", "navSurface", "theme", "output", "result"]) {
    const nested = obj[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  }
  return raw;
}

function stripTopLevelForbidden(
  raw: Record<string, unknown>,
  forbidden: string[]
): Record<string, unknown> {
  const out = { ...raw };
  for (const key of forbidden) {
    delete out[key];
  }
  return out;
}

function normalizeDesignEnums(payload: Record<string, unknown>): Record<string, unknown> {
  const out = normalizeAgentPayload(payload);
  const gradientMoods = new Set(["subtle", "vivid", "monochrome"]);
  const accentRoles = new Set(["sparing", "hero", "editorial"]);
  const pageTones = new Set(["light", "dark", "warm", "cool"]);
  const navTreatments = new Set(["glass-dark", "glass-light", "solid", "minimal"]);
  const surfaces = new Set(["none", "subtle", "elevated", "bordered"]);

  if (out.gradientMood && !gradientMoods.has(String(out.gradientMood))) delete out.gradientMood;
  if (out.accentRole && !accentRoles.has(String(out.accentRole))) delete out.accentRole;
  if (out.pageTone && !pageTones.has(String(out.pageTone))) delete out.pageTone;
  if (out.navTreatment && !navTreatments.has(String(out.navTreatment))) delete out.navTreatment;

  if (out.surfaces && typeof out.surfaces === "object" && !Array.isArray(out.surfaces)) {
    const raw = { ...(out.surfaces as Record<string, unknown>) };
    const coerced: Record<string, string> = {};
    for (const key of ["default", "elevated", "none"] as const) {
      const v = String(raw[key] ?? "").toLowerCase();
      if (surfaces.has(v)) {
        coerced[key] = v;
      } else if (/elevat|shadow|lift/.test(v)) {
        coerced[key] = "elevated";
      } else if (/border|card|panel/.test(v)) {
        coerced[key] = "bordered";
      } else if (/subtle|soft|wash/.test(v)) {
        coerced[key] = "subtle";
      } else if (v) {
        coerced[key] = "none";
      }
    }
    out.surfaces = coerced;
  }

  if (out.layout && typeof out.layout === "object" && !Array.isArray(out.layout)) {
    const layout = { ...(out.layout as Record<string, unknown>) };
    if (layout.gridColumns !== undefined) {
      const n = Number(layout.gridColumns);
      layout.gridColumns = Number.isFinite(n) ? Math.min(6, Math.max(1, n)) : 3;
    }
    out.layout = layout;
  }

  return out;
}

export function validateAgentOutput<T>(
  contract: AgentContract<T>,
  raw: unknown
): T {
  const unwrapped = unwrapAgentPayload(raw);
  let payload: unknown = unwrapped;
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    payload = normalizeDesignEnums(
      stripTopLevelForbidden(unwrapped as Record<string, unknown>, contract.forbiddenFields)
    );
  }

  return contract.outputSchema.parse(payload) as T;
}
