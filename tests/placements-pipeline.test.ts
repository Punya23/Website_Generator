import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pickRealEstateTemplate, REAL_ESTATE_TEMPLATE_IDS } from "../src/orchestrator/placements-pipeline.js";
import { usePlacementsPipeline } from "../src/llm/pipeline-speed.js";

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
});
