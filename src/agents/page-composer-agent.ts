import type { PageBlueprint, SectionInstance } from "../types.js";
import { getTemplate } from "../section-templates/registry.js";

export interface BlueprintSection {
  id: string;
  templateId: string;
  intent: string;
}

/** Order blueprint sections — no injection, no monotony breaks, no hardcoded CTAs. */
export function composePageSections(
  blueprint: PageBlueprint,
  instances: SectionInstance[]
): SectionInstance[] {
  const byId = new Map(instances.map((i) => [i.id, i]));
  return blueprint.sections
    .map((s) => byId.get(s.id))
    .filter((i): i is SectionInstance => Boolean(i))
    .map((s) => ({
      ...s,
      fullBleed: s.fullBleed ?? getTemplate(s.templateId)?.sectionMode === "bleed",
    }));
}
