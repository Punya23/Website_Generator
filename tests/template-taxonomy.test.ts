import { describe, expect, it } from "vitest";
import {
  classifyTemplateTaxonomy,
  navLabels,
} from "../src/templates/ingest/classify-taxonomy.js";
import { resolveTaxonomyScope, sectionTier } from "../src/templates/taxonomy-scope.js";
import { classifyTaxonomy } from "../src/skins/taxonomy.js";
import type { IndexedSection } from "../src/templates/store.js";
import type { SectionRole } from "../src/templates/types.js";

function section(overrides: Partial<IndexedSection> = {}): IndexedSection {
  return {
    templateId: "tpl_x",
    templateName: "X",
    sectionId: "sec_hero",
    role: "hero",
    roleConfidence: 0.8,
    slotKinds: [],
    sourceOrder: 0,
    industryRunnersUp: [],
    universalFit: false,
    ...overrides,
  };
}

/** A template's three chrome-and-hero roles, all carrying the same taxonomy. */
function templateSections(
  templateId: string,
  taxonomy: Partial<IndexedSection>,
  roles: SectionRole[] = ["nav", "hero", "footer"]
): IndexedSection[] {
  return roles.map((role) =>
    section({ templateId, sectionId: `sec_${role}`, role, ...taxonomy })
  );
}

describe("content-based template classification", () => {
  it("lets the hero headline override a bundle folder that says something else", () => {
    // A real bundle case: marketplace sellers file anything vaguely corporate under a
    // "Business, Finance & Law" folder. The template itself says what it is for.
    const result = classifyTemplateTaxonomy({
      folderHint: "Business, Finance & Law",
      templateName: "Ironclad Html Template",
      pageTitles: ["Ironclad — Construction & Industrial"],
      sections: [
        {
          role: "hero",
          headingText: "Trusted plumbing and HVAC contractor",
          text: "Emergency plumbing, heating and drain repair for residential customers.",
        },
      ],
    });
    expect(result.match.industry).toBe("home-services");
    expect(result.source).toBe("combined");
  });

  it("classifies a template whose folder said nothing at all", () => {
    // "Multipurpose & Landing Pages" scores zero on its own — the old folder-only classifier left
    // every template in that folder untagged, which under a hard taxonomy lock means unusable.
    expect(classifyTaxonomy("Multipurpose & Landing Pages").confidence).toBe(0);

    const result = classifyTemplateTaxonomy({
      folderHint: "Multipurpose & Landing Pages",
      templateName: "Nova",
      sections: [
        { role: "hero", headingText: "Fine dining restaurant in the old quarter", text: "Seasonal tasting menu." },
        { role: "features", headingText: "Our kitchen" },
      ],
    });
    expect(result.match.industry).toBe("restaurant");
    expect(result.source).toBe("content");
  });

  it("falls back to the folder when the markup carries no vertical at all", () => {
    const result = classifyTemplateTaxonomy({
      folderHint: "Health & Medical",
      templateName: "Zeta",
      sections: [{ role: "hero", headingText: "Welcome to our website", text: "Lorem ipsum dolor sit amet." }],
    });
    expect(result.match.industry).toBe("health-clinic");
    expect(result.source).toBe("folder");
  });

  it("reports no classification rather than an arbitrary default when nothing says anything", () => {
    const result = classifyTemplateTaxonomy({
      templateName: "Zeta",
      sections: [{ role: "hero", headingText: "Welcome", text: "Lorem ipsum dolor sit amet." }],
    });
    expect(result.source).toBe("none");
    expect(result.match.industryScore).toBe(0);
  });

  it("ignores structural nav labels every template ships", () => {
    // "Blog", "Shop" and "Portfolio" are real taxonomy keywords, and they are also in the menu of
    // nearly every template ever sold — counting them tags generic templates as media/retail.
    const nav = `<nav><a href="#">Home</a><a href="#">Blog</a><a href="#">Shop</a>
      <a href="#">Portfolio</a><a href="#">Our Fleet</a><a href="#">Contact</a></nav>`;
    expect(navLabels(nav)).toEqual(["our fleet"]);

    const result = classifyTemplateTaxonomy({
      templateName: "Haul",
      sections: [
        { role: "nav", html: nav },
        { role: "hero", headingText: "Freight and warehousing", text: "Nationwide cargo distribution." },
      ],
    });
    expect(result.match.industry).toBe("logistics");
  });

  it("does not let bulk body copy outvote the hero", () => {
    // The body mentions a rival vertical far more often than the hero mentions its own; weighting
    // by source is what keeps the hero decisive.
    const result = classifyTemplateTaxonomy({
      sections: [
        { role: "hero", headingText: "Dental clinic", text: "Book a checkup with our dentist." },
        { role: "story", headingText: "Our gym", text: "gym fitness trainer training strength conditioning" },
      ],
    });
    expect(result.match.industry).toBe("health-clinic");
  });
});

describe("hard taxonomy scope", () => {
  const required: SectionRole[] = ["nav", "hero", "footer"];
  const match = classifyTaxonomy("Northwind Freight — nationwide logistics and warehousing");

  it("locks to the exact industry when that alone can build a site", () => {
    const pool = [
      ...templateSections("tpl_logistics", { industry: "logistics", category: "local-service" }),
      ...templateSections("tpl_wedding", { industry: "wedding", category: "creative" }),
    ];
    const scope = resolveTaxonomyScope(pool, match, { requiredRoles: required });
    expect(scope.tier).toBe("industry");
    expect(scope.poolFor("hero").map((s) => s.templateId)).toEqual(["tpl_logistics"]);
  });

  it("never admits an unrelated template just because it ranks well on quality", () => {
    const pool = [
      ...templateSections("tpl_logistics", { industry: "logistics", category: "local-service" }),
      // Higher role confidence and richer slots — under the old ranking-only selection this could
      // still win once the preferred tier was exhausted.
      ...templateSections("tpl_wedding", { industry: "wedding", category: "creative" }).map((s) => ({
        ...s,
        roleConfidence: 1,
        slotKinds: ["tagline", "primaryCta", "sectionHeading"] as IndexedSection["slotKinds"],
      })),
    ];
    const scope = resolveTaxonomyScope(pool, match, { requiredRoles: required });
    expect(scope.poolFor("nav").every((s) => s.templateId === "tpl_logistics")).toBe(true);
  });

  it("descends to the same coarse category when the exact industry cannot build a site", () => {
    // Only a hero in the brief's own industry; nav and footer exist only in a sibling
    // local-service vertical.
    const pool = [
      ...templateSections("tpl_logistics", { industry: "logistics", category: "local-service" }, ["hero"]),
      ...templateSections("tpl_plumb", { industry: "home-services", category: "local-service" }),
    ];
    const scope = resolveTaxonomyScope(pool, match, { requiredRoles: required });
    expect(scope.tier).toBe("category");
    expect(scope.poolFor("nav").map((s) => s.templateId)).toEqual(["tpl_plumb"]);
  });

  it("refuses the unrelated tier in strict mode when the category tier suffices", () => {
    const pool = [
      ...templateSections("tpl_plumb", { industry: "home-services", category: "local-service" }),
      ...templateSections("tpl_wedding", { industry: "wedding", category: "creative" }),
    ];
    const scope = resolveTaxonomyScope(pool, match, { requiredRoles: required });
    expect(scope.tier).toBe("category");
    expect(scope.widenedBeyondStrict).toBe(false);
    expect(scope.poolFor("hero").some((s) => s.templateId === "tpl_wedding")).toBe(false);
  });

  it("breaks the lock, and says so, when the corpus has nothing in the vertical's category", () => {
    const pool = templateSections("tpl_wedding", { industry: "wedding", category: "creative" });
    const scope = resolveTaxonomyScope(pool, match, { requiredRoles: required });
    expect(scope.tier).toBe("any");
    expect(scope.widenedBeyondStrict).toBe(true);
    expect(scope.poolFor("hero")).toHaveLength(1);
  });

  it("widens one optional role without dragging the whole site down a tier", () => {
    // The brief's own industry covers the page's backbone; only the rare `faq` band has to be
    // borrowed from a sibling vertical.
    const pool = [
      ...templateSections("tpl_logistics", { industry: "logistics", category: "local-service" }),
      ...templateSections("tpl_plumb", { industry: "home-services", category: "local-service" }, ["faq"]),
    ];
    const scope = resolveTaxonomyScope(pool, match, { requiredRoles: required });
    expect(scope.tier).toBe("industry");
    expect(scope.poolFor("hero").map((s) => s.templateId)).toEqual(["tpl_logistics"]);
    expect(scope.poolFor("faq").map((s) => s.templateId)).toEqual(["tpl_plumb"]);
    expect(scope.tierByRole.get("faq")).toBe("category");
  });

  it("keeps a multipurpose template out of a tight industry lock, in as a category-tier filler", () => {
    // `universalFit` is an escape hatch, not a wildcard: competing with an exact industry match is
    // exactly the leak that let a bakery brief draw from a dental template.
    const pool = [
      ...templateSections("tpl_logistics", { industry: "logistics", category: "local-service" }),
      ...templateSections("tpl_any", { industry: "wedding", category: "creative", universalFit: true }),
    ];
    const scope = resolveTaxonomyScope(pool, match, { requiredRoles: required });
    expect(scope.tier).toBe("industry");
    expect(scope.poolFor("hero").map((s) => s.templateId)).toEqual(["tpl_logistics"]);

    // With nothing in the vertical, the same template is admitted at the category tier.
    const thin = templateSections("tpl_any", { industry: "wedding", category: "creative", universalFit: true });
    const fallback = resolveTaxonomyScope(thin, match, { requiredRoles: required });
    expect(fallback.tier).toBe("category");
    expect(fallback.poolFor("hero").map((s) => s.templateId)).toEqual(["tpl_any"]);
  });

  it("accepts a near-miss industry one tier below an exact match", () => {
    const near = section({
      industry: "home-services",
      category: "local-service",
      industryRunnersUp: ["logistics"],
    });
    expect(sectionTier(near, match)).toBe("related");
  });

  it("never treats a cross-category near-miss as related", () => {
    // Measured on the real corpus: keyword-score proximity crosses category lines freely, and a
    // creative template listing the brief's industry in its own runners-up was being admitted a
    // tier ABOVE same-category templates. 9 of 32 verticals leaked this way.
    const crossCategory = section({
      industry: "wedding",
      category: "creative",
      industryRunnersUp: ["logistics"],
    });
    expect(sectionTier(crossCategory, match)).toBe("any");

    const pool = [
      ...templateSections("tpl_plumb", { industry: "home-services", category: "local-service" }),
      ...templateSections("tpl_wedding", {
        industry: "wedding",
        category: "creative",
        industryRunnersUp: ["logistics"],
      }),
    ];
    const scope = resolveTaxonomyScope(pool, match, { requiredRoles: required });
    expect(scope.poolFor("hero").map((s) => s.templateId)).toEqual(["tpl_plumb"]);
  });

  it("gates nothing when there is no brief to classify", () => {
    const pool = templateSections("tpl_wedding", { industry: "wedding", category: "creative" });
    const scope = resolveTaxonomyScope(pool, undefined, { requiredRoles: required });
    expect(scope.poolFor("hero")).toHaveLength(1);
  });

  it("falls back to the old ranking-only behaviour when strict scope is disabled", () => {
    const pool = templateSections("tpl_wedding", { industry: "wedding", category: "creative" });
    const scope = resolveTaxonomyScope(pool, match, { requiredRoles: required, strict: false });
    expect(scope.tier).toBe("any");
    expect(scope.widenedBeyondStrict).toBe(false);
  });
});
