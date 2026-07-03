import type { PageBlueprint, SectionInstance } from "../types.js";
import { getTemplate } from "../section-templates/registry.js";

export interface BlueprintSection {
  id: string;
  templateId: string;
  intent: string;
}

export function composePageSections(
  blueprint: PageBlueprint,
  instances: SectionInstance[]
): SectionInstance[] {
  const byId = new Map(instances.map((i) => [i.id, i]));
  let ordered = blueprint.sections
    .map((s) => byId.get(s.id))
    .filter((i): i is SectionInstance => Boolean(i));

  ordered = breakMonotony(ordered, blueprint.slug);
  return ordered;
}

function breakMonotony(sections: SectionInstance[], pageSlug: string): SectionInstance[] {
  const out: SectionInstance[] = [];
  let run = 0;
  let lastTemplate = "";

  for (const section of sections) {
    if (section.templateId === lastTemplate) {
      run++;
    } else {
      run = 1;
      lastTemplate = section.templateId;
    }

    if (run >= 2) {
      out.push({
        id: `${section.id}_break`,
        templateId: "intro_statement",
        intent: "Visual breathing room",
        props: {
          headline: "Crafted with intention",
          body: "Every detail considered for a cohesive brand experience.",
        },
        fullBleed: false,
        motion: "slide-up",
      });
      run = 1;
      lastTemplate = "intro_statement";
    }

    out.push(section);
  }

  const hasCta = out.some((s) => s.templateId === "cta_band");
  if (!hasCta && out.length > 0) {
    const last = out[out.length - 1]!;
    if (last.templateId !== "contact_split") {
      out.push({
        id: `${pageSlug}_close_cta`,
        templateId: "cta_band",
        intent: "Close with conversion",
        props: {
          headline: "Ready to get started?",
          subcopy: "Let's create something remarkable together.",
          cta: { label: "Contact us", href: "/contact" },
        },
        fullBleed: true,
        motion: "slide-up",
      });
    }
  }

  return out.map((s) => ({
    ...s,
    fullBleed: s.fullBleed ?? getTemplate(s.templateId)?.sectionMode === "bleed",
  }));
}
