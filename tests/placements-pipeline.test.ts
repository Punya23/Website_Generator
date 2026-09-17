import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pickRealEstateTemplate, REAL_ESTATE_TEMPLATE_IDS } from "../src/orchestrator/placements-pipeline.js";
import { usePlacementsPipeline, usePlacementsCorpusFill } from "../src/llm/pipeline-speed.js";

describe("pickRealEstateTemplate", () => {
  it("picks the generalist agency template when nothing signals a sub-vertical", () => {
    expect(pickRealEstateTemplate("Golden Gate Realty helps first-time buyers in San Francisco.")).toBe(
      "real-estate-agency"
    );
  });

  it("picks luxury on luxury-signaling language", () => {
    expect(
      pickRealEstateTemplate("Prestige Estates handles exclusive luxury waterfront penthouses for elite clients.")
    ).toBe("luxury-real-estate");
  });

  it("picks commercial on commercial-signaling language", () => {
    expect(
      pickRealEstateTemplate("Metro CRE Partners leases commercial office space and industrial warehouse units to investors.")
    ).toBe("commercial-real-estate");
  });

  it("picks property-management on landlord/tenant language", () => {
    expect(
      pickRealEstateTemplate("Harborview Property Management handles rent collection and maintenance requests for landlords across the city.")
    ).toBe("property-management");
  });

  it("every returned id names a real folder under real-estate/", () => {
    for (const id of REAL_ESTATE_TEMPLATE_IDS) {
      expect(REAL_ESTATE_TEMPLATE_IDS).toContain(id);
    }
  });
});

describe("usePlacementsPipeline", () => {
  const ORIGINAL = process.env.PIPELINE_PLACEMENTS;
  beforeEach(() => {
    delete process.env.PIPELINE_PLACEMENTS;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PIPELINE_PLACEMENTS;
    else process.env.PIPELINE_PLACEMENTS = ORIGINAL;
  });

  it("defaults off", () => {
    expect(usePlacementsPipeline()).toBe(false);
  });

  it("PIPELINE_PLACEMENTS=1 opts in", () => {
    process.env.PIPELINE_PLACEMENTS = "1";
    expect(usePlacementsPipeline()).toBe(true);
  });

  it("PIPELINE_PLACEMENTS=0 stays off even if something else would opt in", () => {
    process.env.PIPELINE_PLACEMENTS = "0";
    expect(usePlacementsPipeline()).toBe(false);
  });

  // Playground's "use curated real-estate templates" checkbox (GenerateSiteOptions.usePlacementsMode)
  // — a per-request override, so one running server can demo both paths without a restart.
  it("an explicit override wins outright over the env var, either direction", () => {
    expect(usePlacementsPipeline(true)).toBe(true);
    expect(usePlacementsPipeline(false)).toBe(false);
    process.env.PIPELINE_PLACEMENTS = "1";
    expect(usePlacementsPipeline(false)).toBe(false);
    process.env.PIPELINE_PLACEMENTS = "0";
    expect(usePlacementsPipeline(true)).toBe(true);
  });

  it("omitting the override falls back to the env var, unchanged from before it existed", () => {
    expect(usePlacementsPipeline(undefined)).toBe(false);
    process.env.PIPELINE_PLACEMENTS = "1";
    expect(usePlacementsPipeline(undefined)).toBe(true);
  });
});

describe("usePlacementsCorpusFill", () => {
  const ORIGINAL = process.env.PIPELINE_PLACEMENTS_CORPUS;
  beforeEach(() => {
    delete process.env.PIPELINE_PLACEMENTS_CORPUS;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PIPELINE_PLACEMENTS_CORPUS;
    else process.env.PIPELINE_PLACEMENTS_CORPUS = ORIGINAL;
  });

  it("defaults off", () => {
    expect(usePlacementsCorpusFill()).toBe(false);
  });

  it("PIPELINE_PLACEMENTS_CORPUS=1 opts in", () => {
    process.env.PIPELINE_PLACEMENTS_CORPUS = "1";
    expect(usePlacementsCorpusFill()).toBe(true);
  });

  it("PIPELINE_PLACEMENTS_CORPUS=0 stays off even if something else would opt in", () => {
    process.env.PIPELINE_PLACEMENTS_CORPUS = "0";
    expect(usePlacementsCorpusFill()).toBe(false);
  });

  it("is a distinct flag from PIPELINE_PLACEMENTS — the curated path opting in does not opt this in", () => {
    process.env.PIPELINE_PLACEMENTS = "1";
    expect(usePlacementsCorpusFill()).toBe(false);
    delete process.env.PIPELINE_PLACEMENTS;
  });

  it("an explicit override wins outright over the env var, either direction", () => {
    expect(usePlacementsCorpusFill(true)).toBe(true);
    expect(usePlacementsCorpusFill(false)).toBe(false);
    process.env.PIPELINE_PLACEMENTS_CORPUS = "1";
    expect(usePlacementsCorpusFill(false)).toBe(false);
    process.env.PIPELINE_PLACEMENTS_CORPUS = "0";
    expect(usePlacementsCorpusFill(true)).toBe(true);
  });

  it("omitting the override falls back to the env var, unchanged from before it existed", () => {
    expect(usePlacementsCorpusFill(undefined)).toBe(false);
    process.env.PIPELINE_PLACEMENTS_CORPUS = "1";
    expect(usePlacementsCorpusFill(undefined)).toBe(true);
  });
});
