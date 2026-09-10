import { describe, expect, it } from "vitest";
import { getSkin } from "../src/skins/catalog.js";
import { themeFromSkin } from "../src/skins/theme.js";
import { SKIN_TOKEN_PACKS } from "../src/skins/tokens.js";
import { renderSkinHtmlSite, pageHref } from "../src/skins/render-html-site.js";
import { mockFillSkinCopy, instancesFromSkinCopy } from "../src/agents/skin-fill-agent.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { MediaRegistry } from "../src/media/media-registry.js";
import { mockPlan } from "./helpers/mock-site.js";

const brief = {
  businessName: "Harbor Wealth",
  tagline: "Clear advice",
  elevatorPitch: "Fiduciary planning for families.",
  expandedBrief: "Harbor Wealth is a fiduciary advisory firm for families.",
  targetAudience: "Families",
  services: ["Planning", "Investing", "Tax"],
  differentiators: ["Fee-only", "Fiduciary", "Local"],
  tone: "calm",
  primaryCta: "Book a review",
};

describe("skin HTML websites", () => {
  it("rewrites inner routes to html files", () => {
    expect(pageHref("/contact")).toBe("contact.html");
    expect(pageHref("/about")).toBe("about.html");
    expect(pageHref("/")).toBe("index.html");
  });

  it("gives each authored skin its own token pack, not one pipeline palette", () => {
    const salon = themeFromSkin(getSkin("local-service-salon")!, brief);
    const counsel = themeFromSkin(getSkin("professional-counsel")!, brief);
    expect(salon.colors.bg).toBe(SKIN_TOKEN_PACKS["local-service-salon"]!.colors.bg);
    expect(counsel.colors.bg).toBe(SKIN_TOKEN_PACKS["professional-counsel"]!.colors.bg);
    expect(salon.colors.bg).not.toBe(counsel.colors.bg);
    expect(salon.fontHeading).not.toBe(counsel.fontHeading);
  });

  it("renders full html pages linked to each other from the frozen templates", async () => {
    const skin = getSkin("professional-counsel")!;
    const ctx = initSiteContext(brief.expandedBrief, brief, mockPlan(brief), themeFromSkin(skin, brief));
    ctx.businessName = brief.businessName;
    const copy = mockFillSkinCopy(ctx, skin);
    const instances = await instancesFromSkinCopy(ctx, skin, copy, new MediaRegistry(), { enrichMedia: false });
    const pages = renderSkinHtmlSite(ctx, skin, instances);
    expect(Object.keys(pages)).toEqual(["home", "about", "services", "contact"]);
    expect(pages.home).toContain("site-nav");
    expect(pages.home).toContain("about.html");
    expect(pages.home).toContain("contact.html");
    expect(pages.about).toContain("index.html");
    expect(pages.home).toContain(`data-skin="${skin.id}"`);
    expect(pages.home).toContain('data-template="hero_statement"');
    expect(pages.home).toContain("reveal");
    expect(pages.home).toContain(SKIN_TOKEN_PACKS["professional-counsel"]!.fontHeading);
    for (const html of Object.values(pages)) {
      expect(html).toContain(brief.businessName);
      expect(html).toContain("<!doctype html>");
    }
    expect(pages.contact).toContain("<form");
  });

  it("keeps salon video hero and counsel type hero as different templates", async () => {
    const salon = getSkin("local-service-salon")!;
    const counsel = getSkin("professional-counsel")!;
    const salonCtx = initSiteContext(brief.expandedBrief, brief, mockPlan(brief), themeFromSkin(salon, brief));
    const counselCtx = initSiteContext(brief.expandedBrief, brief, mockPlan(brief), themeFromSkin(counsel, brief));
    salonCtx.businessName = brief.businessName;
    counselCtx.businessName = brief.businessName;
    const salonHtml = renderSkinHtmlSite(
      salonCtx,
      salon,
      await instancesFromSkinCopy(salonCtx, salon, mockFillSkinCopy(salonCtx, salon), new MediaRegistry(), {
        enrichMedia: false,
      })
    ).home!;
    const counselHtml = renderSkinHtmlSite(
      counselCtx,
      counsel,
      await instancesFromSkinCopy(counselCtx, counsel, mockFillSkinCopy(counselCtx, counsel), new MediaRegistry(), {
        enrichMedia: false,
      })
    ).home!;
    expect(salonHtml).toContain('data-template="hero_video"');
    expect(counselHtml).toContain('data-template="hero_statement"');
    expect(salonHtml).toContain(SKIN_TOKEN_PACKS["local-service-salon"]!.colors.bg);
    expect(counselHtml).toContain(SKIN_TOKEN_PACKS["professional-counsel"]!.colors.bg);
    expect(salonHtml).toContain("floating-panel");
    expect(counselHtml).toContain("full-width");
  });
});
