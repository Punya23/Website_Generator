import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SITE_SKINS, getSkin, listSkinIds } from "../src/skins/catalog.js";
import {
  SkinHistoryStore,
  classifySkinCategory,
  pickSkinFromCatalog,
  pickSiteSkin,
} from "../src/skins/picker.js";
import { skinSectionId } from "../src/skins/schema.js";
import {
  instancesFromSkinCopy,
  mockFillSkinCopy,
  validateFilledCopy,
} from "../src/agents/skin-fill-agent.js";
import { resolveContactFormConfig, stampContactFormProps } from "../src/forms/contact-form.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { MediaRegistry } from "../src/media/media-registry.js";
import { mockPlan } from "./helpers/mock-site.js";
import { getTemplate } from "../src/section-templates/registry.js";

const CONVERSION = new Set(["cta_band", "footer_cta"]);

function brief(overrides: Partial<{ businessName: string; expandedBrief: string; services: string[] }> = {}) {
  return {
    businessName: overrides.businessName ?? "ClearSmile Dental",
    tagline: "Family dentistry",
    elevatorPitch: "Gentle family dentistry with same-week appointments.",
    expandedBrief:
      overrides.expandedBrief ??
      "ClearSmile Dental is a family dentistry clinic offering cosmetic whitening.",
    targetAudience: "Local families",
    services: overrides.services ?? ["Checkups", "Whitening", "Invisalign"],
    differentiators: ["Same-week appointments", "Gentle care", "Modern chairs"],
    tone: "Calm and clinical",
    primaryCta: "Book a visit",
  };
}

describe("site skins catalog", () => {
  it("ships 16+ authored skins with distinct page sequences", () => {
    expect(SITE_SKINS.length).toBeGreaterThanOrEqual(16);
    expect(listSkinIds().length).toBeGreaterThanOrEqual(SITE_SKINS.length);
    expect(new Set(listSkinIds()).size).toBe(listSkinIds().length);

    const homeSignatures = new Set<string>();
    const aboutOpeners = SITE_SKINS.map((skin) => skin.pages.about[0]?.templateId);

    for (const skin of SITE_SKINS) {
      const home = skin.pages.home;
      expect(home[0]?.templateId.startsWith("hero_")).toBe(true);
      expect(getTemplate(home[0]!.templateId)).toBeTruthy();
      homeSignatures.add(home.map((section) => section.templateId).join(">"));

      for (const [slug, sections] of Object.entries(skin.pages)) {
        const closers = sections.filter((section) => CONVERSION.has(section.templateId));
        expect(closers.length, `${skin.id} ${slug} closers`).toBeLessThanOrEqual(1);
        if (slug !== "home") {
          expect(sections.map((section) => section.templateId).join(",")).not.toBe(
            home.map((section) => section.templateId).join(",")
          );
        }
        for (const section of sections) {
          expect(getTemplate(section.templateId), `${skin.id} ${section.templateId}`).toBeTruthy();
        }
      }
    }

    expect(homeSignatures.size).toBe(SITE_SKINS.length);
    expect(aboutOpeners.filter((id) => id === "intro_statement").length).toBeLessThan(
      SITE_SKINS.length / 2
    );
    expect(aboutOpeners).toContain("story_split");

    const creativeFamilies = new Set(
      SITE_SKINS.filter((skin) => skin.categories.includes("creative")).map((skin) => skin.visualFamily)
    );
    expect(creativeFamilies.size).toBeGreaterThanOrEqual(3);
  });

  it("mock-fills every skin without schema errors", async () => {
    const expanded = brief();
    const ctx = initSiteContext("Catalog", expanded, mockPlan(expanded), {
      vertical: "trades",
      mood: "practical",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fafafa",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#c2410c",
        accentSoft: "#fff7ed",
        gradientFrom: "#c2410c",
        gradientTo: "#f97316",
        navBg: "#fff",
      },
    });
    for (const skin of SITE_SKINS) {
      const copy = mockFillSkinCopy(ctx, skin);
      const instances = await instancesFromSkinCopy(ctx, skin, copy, new MediaRegistry(), {
        enrichMedia: false,
      });
      for (const [slug, sections] of Object.entries(instances)) {
        expect(sections.length, `${skin.id} ${slug}`).toBe(skin.pages[slug as keyof typeof skin.pages].length);
        for (const section of sections) {
          const checked = validateFilledCopy(section.templateId, section.props);
          expect(checked.ok, `${skin.id} ${section.templateId}: ${!checked.ok ? checked.error : ""}`).toBe(true);
        }
      }
    }
  });
});

describe("skin picker", () => {
  it("classifies briefs into catalog categories", () => {
    expect(
      classifySkinCategory(
        brief({
          businessName: "Hartwell & Associates",
          expandedBrief: "Boutique litigation firm serving startups and founders",
        })
      )
    ).toBe("professional");
    expect(
      classifySkinCategory(
        brief({
          businessName: "Moonrise Bakery",
          expandedBrief: "Artisan sourdough and pastries in Brooklyn",
        })
      )
    ).toBe("hospitality");
    expect(
      classifySkinCategory(
        brief({
          businessName: "Linea Studio",
          expandedBrief: "Sustainable residential architecture and design studio",
        })
      )
    ).toBe("creative");
    expect(classifySkinCategory(brief())).toBe("local-service");
    expect(
      classifySkinCategory(
        brief({
          businessName: "Northside Yoga",
          expandedBrief: "Neighborhood yoga studio and fitness floor with morning classes",
        })
      )
    ).toBe("local-service");
    expect(
      classifySkinCategory(
        brief({
          businessName: "Fern & Finch",
          expandedBrief: "Walk-in florist and gift shop for local orders",
        })
      )
    ).toBe("local-service");
  });

  it("does not repeat a skin for the same consumer until the catalog is exhausted", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-skins-"));
    const store = new SkinHistoryStore(path.join(dir, "history.json"));
    const dental = brief();
    const first = await pickSiteSkin({
      brief: dental,
      consumerId: "ada",
      variationSeed: 11,
      history: store,
    });
    const second = await pickSiteSkin({
      brief: dental,
      consumerId: "ada",
      variationSeed: 11,
      history: store,
    });
    expect(second.id).not.toBe(first.id);

    const other = await pickSiteSkin({
      brief: dental,
      consumerId: "other",
      variationSeed: 11,
      history: store,
    });
    expect(other.id).toBe(first.id);
  });

  it("picks unused skins from the matching category first", () => {
    const dental = brief();
    const used = ["local-service-clinic"];
    const next = pickSkinFromCatalog({
      brief: dental,
      usedSkinIds: used,
      variationSeed: 3,
    });
    expect(next.categories).toContain("local-service");
    expect(next.id).not.toBe("local-service-clinic");
  });
});

describe("skin slot fill", () => {
  it("keeps frozen section order when filling copy", async () => {
    const skin = getSkin("local-service-trades")!;
    const expanded = brief({
      businessName: "Northline Plumbing",
      expandedBrief: "Emergency plumbing and HVAC contractor",
    });
    const ctx = initSiteContext("Plumbing", expanded, mockPlan(expanded), {
      vertical: "trades",
      mood: "practical",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fafafa",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#c2410c",
        accentSoft: "#fff7ed",
        gradientFrom: "#c2410c",
        gradientTo: "#f97316",
        navBg: "#fff",
      },
    });
    const copy = mockFillSkinCopy(ctx, skin);
    const instances = await instancesFromSkinCopy(ctx, skin, copy, new MediaRegistry(), {
      enrichMedia: false,
    });
    expect(Object.keys(instances)).toEqual(["home", "about", "services", "contact"]);
    expect(instances.home!.map((section) => section.templateId)).toEqual(
      skin.pages.home.map((section) => section.templateId)
    );
    expect(instances.contact!.map((section) => section.templateId)).toEqual(
      skin.pages.contact.map((section) => section.templateId)
    );
    expect(instances.contact!.some((section) => section.templateId === "quote_calculator")).toBe(true);
  });

  it("validates copy against template Zod schemas", () => {
    const ok = validateFilledCopy("hero_editorial", {
      headline: "Northline Plumbing",
      subcopy: "Same-day call-outs across Austin",
      cta: { label: "Book a visit", href: "/contact" },
    });
    expect(ok.ok).toBe(true);

    const bad = validateFilledCopy("not_a_template", { headline: "Nope" });
    expect(bad.ok).toBe(false);
  });

  it("assigns stable section ids from the skin recipe", () => {
    expect(skinSectionId("home", 0, "hero_split_cinematic")).toBe("home_0_herosplitcinematic");
  });
});

describe("contact form config", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("posts to FormSubmit when no Web3Forms key is set", () => {
    delete process.env.WEB3FORMS_ACCESS_KEY;
    const config = resolveContactFormConfig("hello@clinic.com");
    expect(config.provider).toBe("formsubmit");
    expect(config.action).toContain("formsubmit.co");
    expect(config.action).toContain("hello%40clinic.com");
    expect(config.redirectPath).toBe("/thank-you");
  });

  it("posts to Web3Forms when an access key is present", () => {
    process.env.WEB3FORMS_ACCESS_KEY = "test-key";
    const config = resolveContactFormConfig("hello@clinic.com");
    expect(config.provider).toBe("web3forms");
    expect(config.action).toBe("https://api.web3forms.com/submit");
    expect(config.accessKey).toBe("test-key");
  });

  it("stamps form action fields onto contact props", () => {
    delete process.env.WEB3FORMS_ACCESS_KEY;
    const stamped = stampContactFormProps({ headline: "Get in touch" }, "ClearSmile Dental");
    expect(stamped.formProvider).toBe("formsubmit");
    expect(String(stamped.formAction)).toContain("formsubmit.co");
    expect(stamped.redirectPath).toBe("/thank-you");
    expect(String(stamped.email)).toContain("@");
  });
});

describe("theme from skin", () => {
  it("takes chrome and motion from the skin, not from brief-regex profile defaults", async () => {
    const { themeFromSkin, applySkinToContext } = await import("../src/skins/theme.js");
    const skin = getSkin("local-service-salon")!;
    expect(skin.chrome.navShape).toBe("floating-panel");
    expect(skin.motionPreset).toBe("stagger");
    expect(skin.chrome.grainOverlay).toBe(true);

    // A finance brief would regex-classify as corporate-light (full-width nav, fade-up motion).
    const financeBrief = brief({
      businessName: "Harbor Wealth",
      expandedBrief: "Financial advisory and wealth management for families",
      services: ["Advisory", "Planning", "Tax"],
    });
    const theme = themeFromSkin(skin, financeBrief);
    expect(theme.navShape).toBe("floating-panel");
    expect(theme.motionPreset).toBe("stagger");
    expect(theme.pageTone).toBe("dark");
    expect(theme.colors.bg).toBe("#140f12");
    expect(theme.fontHeading).toBe("Cormorant Garamond");
    expect(theme.colors.bg).not.toBe("#f1f5f9");

    const ctx = initSiteContext("Wealth", financeBrief, mockPlan(financeBrief), theme);
    applySkinToContext(ctx, skin);
    expect(ctx.verticalProfile?.profileId).toBe("luxury-dark");
    expect(ctx.verticalProfile?.grainOverlay).toBe(true);
    expect(ctx.designSystem.navShape).toBe(skin.chrome.navShape);
    expect(ctx.sitePlan.pages.map((p) => p.slug)).toEqual(Object.keys(skin.pages));
  });

  it("assembles pages from the skin templates without stamping visual-contract paint", async () => {
    const { applySkinToContext } = await import("../src/skins/theme.js");
    const { assembleReactPages, directorQaFrom } = await import("../src/orchestrator/react-pipeline.js");
    const { skinInstancesToBlueprints } = await import("../src/agents/skin-fill-agent.js");
    const skin = getSkin("hospitality-restaurant")!;
    const expanded = brief({
      businessName: "Marigold",
      expandedBrief: "Neighborhood restaurant",
    });
    const ctx = initSiteContext("Dining", expanded, mockPlan(expanded), {
      vertical: "food",
      mood: "warm",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fff",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#ea580c",
        accentSoft: "#ffedd5",
        gradientFrom: "#ea580c",
        gradientTo: "#f97316",
        navBg: "#fff",
      },
    });
    applySkinToContext(ctx, skin);
    const copy = mockFillSkinCopy(ctx, skin);
    const heroId = skinSectionId("home", 0, "hero_editorial");
    expect(copy.home![heroId]!.headline).toBe("Marigold");
    expect((copy.home![heroId]!.cta as { label: string }).label).toBe("Book a visit");
    const instances = await instancesFromSkinCopy(ctx, skin, copy, new MediaRegistry(), { enrichMedia: false });
    const blueprints = skinInstancesToBlueprints(skin, instances);
    directorQaFrom(ctx, blueprints, instances, skin);
    const pages = assembleReactPages(
      ctx,
      ctx.sitePlan.pages.map((page) => ({
        blueprint: blueprints.find((bp) => bp.slug === page.slug)!,
        instances: instances[page.slug] ?? [],
      }))
    );
    expect(pages.home.sections.map((s) => s.templateId)).toEqual(skin.pages.home.map((s) => s.templateId));
    expect(pages.home.sections[0]?.props.layoutVariant).toBe("full-bleed-left");
    expect(pages.home.sections[0]?.props.bandFill).toBeUndefined();
    expect(pages.home.sections[0]?.props.visualFx).toBeUndefined();
    expect(ctx.chromeSpec?.footer.layout).toBe(skin.chrome.footerLayout);
    expect(ctx.designSystem.navShape).toBe(skin.chrome.navShape);
  });
});
